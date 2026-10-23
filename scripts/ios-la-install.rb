# Installs KIN's Live Activity (ios/LiveActivity) into ANY Xcode project. Idempotent: running it
# again changes nothing. Run via scripts/ios-la-install.sh (it finds CocoaPods' xcodeproj gem).
#
#   Capacitor (today):  ios-la-install.sh --project ios/App/App.xcodeproj --app-target App --bridge capacitor
#   Unity (next):       ios-la-install.sh --project <export>/Unity-iPhone.xcodeproj --app-target Unity-iPhone \
#                                         --native-target UnityFramework --bridge unity --copy
#
# What it does
#   app target      + Shared/*.swift (model, store, CareIntent), the App Group entitlement,
#                     NSSupportsLiveActivities in its Info.plist, embeds the widget extension
#   native target   + Engine/KINLiveEngine.swift (+ Unity/KINLiveUnity.swift for --bridge unity)
#                     and the model/store (the app target itself unless --native-target is given)
#   KINWidgets      a WidgetKit extension (iOS 17+) with Widget/*.swift, the asset catalog, and
#                     the model/store/intent sources
# Files are referenced in place (relative to the project) or, with --copy, vendored next to the
# project first (use --copy for Unity exports, which are regenerated and moved around).
require 'xcodeproj'
require 'optparse'
require 'fileutils'
require 'pathname'

opts = { bridge: 'capacitor', group: 'group.com.mutaafaziz.kin', copy: false }
OptionParser.new do |o|
  o.on('--project PATH') { |v| opts[:project] = v }
  o.on('--app-target NAME') { |v| opts[:app] = v }
  o.on('--native-target NAME', 'where the engine + bridge compile (default: the app target)') { |v| opts[:native] = v }
  o.on('--bridge KIND', 'capacitor | unity | none') { |v| opts[:bridge] = v }
  o.on('--app-group ID') { |v| opts[:group] = v }
  o.on('--widget-bundle-id ID', 'default: <app bundle id>.widgets') { |v| opts[:wid] = v }
  o.on('--source DIR', 'default: <repo>/ios/LiveActivity') { |v| opts[:source] = v }
  o.on('--copy', 'vendor the folder next to the project as KINLiveActivity/') { opts[:copy] = true }
end.parse!
abort('--project and --app-target are required') unless opts[:project] && opts[:app]

project_path = File.expand_path(opts[:project])
proj_dir = File.dirname(project_path)
source = File.expand_path(opts[:source] || File.join(__dir__, '..', 'ios', 'LiveActivity'))
if opts[:copy]
  dest = File.join(proj_dir, 'KINLiveActivity')
  FileUtils.rm_rf(dest)
  FileUtils.cp_r(source, dest)
  source = dest
end
rel = Pathname.new(source).relative_path_from(Pathname.new(proj_dir)).to_s

project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |t| t.name == opts[:app] } or abort("target #{opts[:app]} not found")
native = opts[:native] ? (project.targets.find { |t| t.name == opts[:native] } or abort("target #{opts[:native]} not found")) : app

# --- Remove references to files that no longer exist (e.g. the pre-move ios/App/Shared) ------
project.files.each do |f|
  path = f.real_path.to_s rescue next
  next if File.exist?(path) || f.source_tree != '<group>'
  next unless path.end_with?('.swift', '.plist', '.entitlements', '.xcassets')
  project.targets.each { |t| t.build_phases.each { |ph| ph.remove_file_reference(f) if ph.respond_to?(:remove_file_reference) } }
  f.remove_from_project
end
project.main_group.recursive_children_groups.each do |g|
  g.remove_from_project if g.children.empty? && %w[Shared KINWidgets].include?(g.display_name)
end

# --- Groups mirroring ios/LiveActivity --------------------------------------------------------
root = project.main_group.children.find { |g| g.respond_to?(:display_name) && g.display_name == 'KINLiveActivity' } ||
       project.main_group.new_group('KINLiveActivity', rel)
root.path = rel
def sub(root, name)
  root.children.find { |g| g.respond_to?(:path) && g.path == name } || root.new_group(name, name)
end
def ref(group, name)
  group.files.find { |f| f.path == name } || group.new_reference(name)
end
def add_src(target, r)
  target.source_build_phase.add_file_reference(r, true) unless target.source_build_phase.files_references.include?(r)
end
def drop_src(target, r)
  target.source_build_phase.files.select { |bf| bf.file_ref == r }.each { |bf| target.source_build_phase.remove_build_file(bf) }
end

shared_g = sub(root, 'Shared')
engine_g = sub(root, 'Engine')
widget_g = sub(root, 'Widget')
unity_g = sub(root, 'Unity')

model = %w[KINAttributes.swift KINStore.swift].map { |f| ref(shared_g, f) }
intent = ref(shared_g, 'CareIntent.swift')
engine = ref(engine_g, 'KINLiveEngine.swift')
unity_bridge = ref(unity_g, 'KINLiveUnity.swift')
ref(unity_g, 'KINLive.cs') # for reference only: it belongs in the Unity project's Assets, never compiled here
views = %w[KINWidgetsBundle.swift KINLiveActivity.swift KINActivityViews.swift KINPortrait.swift].map { |f| ref(widget_g, f) }
assets = ref(widget_g, 'Assets.xcassets')
ref(widget_g, 'Info.plist')
ref(widget_g, 'KINWidgets.entitlements')

# --- App + native targets -------------------------------------------------------------------
# The intent runs in the app's process; ActivityKit matches KINAttributes by type name, so when the
# engine compiles into another module (UnityFramework) both modules carry their own copy.
(model + [intent]).each { |r| add_src(app, r) }
(model + [engine]).each { |r| add_src(native, r) }
opts[:bridge] == 'unity' ? add_src(native, unity_bridge) : drop_src(native, unity_bridge)
# SwiftUI views never compile into the app (hard-links SwiftUICore, crashing iOS 15–17 at launch).
views.each { |r| project.targets.each { |t| drop_src(t, r) unless t.name == 'KINWidgets' } }

app_bundle_id = app.build_configurations.first.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] || 'com.mutaafaziz.kin'
[app, native].uniq.each do |t|
  t.build_configurations.each do |c|
    c.build_settings['SWIFT_VERSION'] ||= '5.0'
    # Xcode's debug-dylib mode links SwiftUICore directly (iOS 18+ only): crashes on 15–17.
    c.build_settings['ENABLE_DEBUG_DYLIB'] = 'NO'
  end
end

# App Group entitlement on the app (create the file if the app has none, e.g. Unity exports).
ent_rel = app.build_configurations.first.build_settings['CODE_SIGN_ENTITLEMENTS']
unless ent_rel
  ent_rel = "#{opts[:app]}/KINApp.entitlements"
  FileUtils.mkdir_p(File.join(proj_dir, opts[:app]))
end
ent_path = File.join(proj_dir, ent_rel)
ent = File.exist?(ent_path) ? Xcodeproj::Plist.read_from_path(ent_path) : {}
groups = (ent['com.apple.security.application-groups'] || []) | [opts[:group]]
ent['com.apple.security.application-groups'] = groups
Xcodeproj::Plist.write_to_path(ent, ent_path)
app.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = ent_rel }

# NSSupportsLiveActivities in the app's Info.plist.
info_rel = app.build_configurations.first.build_settings['INFOPLIST_FILE']
if info_rel
  info_path = File.join(proj_dir, info_rel.sub('$(SRCROOT)/', ''))
  if File.exist?(info_path)
    info = Xcodeproj::Plist.read_from_path(info_path)
    unless info['NSSupportsLiveActivities'] == true
      info['NSSupportsLiveActivities'] = true
      Xcodeproj::Plist.write_to_path(info, info_path)
    end
  end
end

# --- Widget extension -----------------------------------------------------------------------
widgets = project.targets.find { |t| t.name == 'KINWidgets' } ||
          project.new_target(:app_extension, 'KINWidgets', :ios, '17.0', nil, :swift)
(views + model + [intent]).each { |r| add_src(widgets, r) }
widgets.resources_build_phase.add_file_reference(assets, true) unless widgets.resources_build_phase.files_references.include?(assets)
%w[SwiftUI WidgetKit ActivityKit AppIntents].each do |fw|
  path = "System/Library/Frameworks/#{fw}.framework"
  next if widgets.frameworks_build_phase.files_references.any? { |r| r.path == path }
  r = project.frameworks_group.files.find { |f| f.path == path } || project.frameworks_group.new_reference(path, :sdk_root)
  widgets.frameworks_build_phase.add_file_reference(r, true)
end
team = app.build_configurations.first.build_settings['DEVELOPMENT_TEAM']
widgets.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = opts[:wid] || "#{app_bundle_id}.widgets"
  s['INFOPLIST_FILE'] = "#{rel}/Widget/Info.plist"
  s['CODE_SIGN_ENTITLEMENTS'] = "#{rel}/Widget/KINWidgets.entitlements"
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['DEVELOPMENT_TEAM'] = team if team
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SWIFT_VERSION'] = '5.0'
  s['SKIP_INSTALL'] = 'YES'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['MARKETING_VERSION'] = app.build_configurations.first.build_settings['MARKETING_VERSION'] || '0.1.0'
  s['CURRENT_PROJECT_VERSION'] = app.build_configurations.first.build_settings['CURRENT_PROJECT_VERSION'] || '1'
  s['ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME'] = ''
  s['ASSETCATALOG_COMPILER_APPICON_NAME'] = ''
  s['DEVELOPMENT_ASSET_PATHS'] = ''
  s['ENABLE_DEBUG_DYLIB'] = 'NO'
end
# The widget's own entitlements carry the same App Group.
went_path = File.join(source, 'Widget', 'KINWidgets.entitlements')
went = File.exist?(went_path) ? Xcodeproj::Plist.read_from_path(went_path) : {}
went['com.apple.security.application-groups'] = ((went['com.apple.security.application-groups'] || []) | [opts[:group]])
Xcodeproj::Plist.write_to_path(went, went_path)

# App Groups capability (so automatic signing registers it).
attrs = project.root_object.attributes['TargetAttributes'] ||= {}
[app, widgets].each do |t|
  a = attrs[t.uuid] ||= {}
  a['ProvisioningStyle'] = 'Automatic'
  caps = a['SystemCapabilities'] ||= {}
  caps['com.apple.ApplicationGroups.iOS'] = { 'enabled' => 1 }
end

# --- Embed the extension in the app ---------------------------------------------------------
app.add_dependency(widgets) unless app.dependencies.any? { |d| d.target == widgets }
embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' } ||
        app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.symbol_dst_subfolder_spec = :plug_ins
unless embed.files_references.include?(widgets.product_reference)
  bf = embed.add_file_reference(widgets.product_reference, true)
  bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
end

project.save
puts "KIN Live Activity installed in #{File.basename(project_path)}: app=#{app.name} native=#{native.name} bridge=#{opts[:bridge]} source=#{rel}"
