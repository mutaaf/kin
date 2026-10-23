# Adds the KINWidgets Live Activity extension to ios/App/App.xcodeproj. Idempotent: running it
# again changes nothing. Run via scripts/ios-add-widget.sh (it finds CocoaPods' xcodeproj gem).
#
#   App target      + Shared/*.swift, App/LiveActivityPlugin.swift, App/KINBridgeViewController.swift,
#                     App/App.entitlements, embeds KINWidgets.appex
#   KINWidgets      a WidgetKit extension (iOS 17+) with KINWidgets/*.swift + Shared/*.swift
require 'xcodeproj'

root = File.expand_path('../ios/App', __dir__)
project_path = File.join(root, 'App.xcodeproj')
project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |t| t.name == 'App' } or abort('App target not found')

def group_for(project, name, path)
  project.main_group.children.find { |g| g.respond_to?(:path) && g.path == path } ||
    project.main_group.new_group(name, path)
end

def file_ref(group, name)
  group.files.find { |f| f.path == name } || group.new_reference(name)
end

def add_source(target, ref)
  target.source_build_phase.add_file_reference(ref, true) unless target.source_build_phase.files_references.include?(ref)
end

# --- Shared sources (compiled into both targets) ---------------------------------------------
shared = group_for(project, 'Shared', 'Shared')
# Model + intent: compiled into both targets. Views: widget only. Compiling SwiftUI views into
# the app made its binary hard-link SwiftUICore (iOS 18+ only), crashing it at launch on iOS 15–17.
shared_refs = %w[KINAttributes.swift KINStore.swift CareIntent.swift].map { |f| file_ref(shared, f) }
view_refs = %w[KINPortrait.swift KINActivityViews.swift].map { |f| file_ref(shared, f) }
view_refs.each do |r|
  app.source_build_phase.files.select { |bf| bf.file_ref == r }.each { |bf| app.source_build_phase.remove_build_file(bf) }
end

# --- App target additions ---------------------------------------------------------------------
app_group = project.main_group.children.find { |g| g.respond_to?(:path) && g.path == 'App' } or abort('App group not found')
app_refs = %w[LiveActivityPlugin.swift KINBridgeViewController.swift].map { |f| file_ref(app_group, f) }
file_ref(app_group, 'App.entitlements')
(shared_refs + app_refs).each { |r| add_source(app, r) }
app.build_configurations.each do |c|
  c.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'App/App.entitlements'
  # Xcode's debug-dylib mode links SwiftUICore directly, which only exists on iOS 18+: Debug
  # builds then crash at launch on iOS 15–17 ("Library not loaded: SwiftUICore").
  c.build_settings['ENABLE_DEBUG_DYLIB'] = 'NO'
end

# --- Widget extension target ------------------------------------------------------------------
widgets = project.targets.find { |t| t.name == 'KINWidgets' }
unless widgets
  widgets = project.new_target(:app_extension, 'KINWidgets', :ios, '17.0', nil, :swift)
end
wgroup = group_for(project, 'KINWidgets', 'KINWidgets')
w_refs = %w[KINWidgetsBundle.swift KINLiveActivity.swift].map { |f| file_ref(wgroup, f) }
file_ref(wgroup, 'Info.plist')
file_ref(wgroup, 'KINWidgets.entitlements')
(w_refs + shared_refs + view_refs).each { |r| add_source(widgets, r) }

%w[SwiftUI WidgetKit ActivityKit AppIntents].each do |fw|
  path = "System/Library/Frameworks/#{fw}.framework"
  next if widgets.frameworks_build_phase.files_references.any? { |r| r.path == path }
  ref = project.frameworks_group.files.find { |f| f.path == path } ||
        project.frameworks_group.new_reference(path, :sdk_root)
  widgets.frameworks_build_phase.add_file_reference(ref, true)
end

widgets.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.mutaafaziz.kin.widgets'
  s['INFOPLIST_FILE'] = 'KINWidgets/Info.plist'
  s['CODE_SIGN_ENTITLEMENTS'] = 'KINWidgets/KINWidgets.entitlements'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SWIFT_VERSION'] = '5.0'
  s['SKIP_INSTALL'] = 'YES'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  # Versions must match the app (the TestFlight script also passes them on the command line).
  s['MARKETING_VERSION'] = '0.1.0'
  s['CURRENT_PROJECT_VERSION'] = '1'
  s['ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME'] = ''
  s['DEVELOPMENT_ASSET_PATHS'] = ''
  s['ENABLE_DEBUG_DYLIB'] = 'NO'
end

# --- Embed the extension in the app ----------------------------------------------------------
app.add_dependency(widgets) unless app.dependencies.any? { |d| d.target == widgets }
embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' } ||
        app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
unless embed.files_references.include?(widgets.product_reference)
  bf = embed.add_file_reference(widgets.product_reference, true)
  bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
end

# --- Drop references to files that moved or were deleted (keeps re-runs clean) ---------------
[shared, wgroup, app_group].each do |g|
  g.files.each do |f|
    next if File.exist?(File.join(root, g.path, f.path))
    project.targets.each { |t| t.build_phases.each { |ph| ph.remove_file_reference(f) if ph.respond_to?(:remove_file_reference) } }
    f.remove_from_project
  end
end

project.save
puts "KINWidgets ready (targets: #{project.targets.map(&:name).join(', ')})"
