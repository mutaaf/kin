# Adds KIN's AR sources (ios/App/App/AR*.swift) to the App target. Idempotent: running it again
# changes nothing. Run via scripts/ios-add-ar.sh (uses CocoaPods' bundled xcodeproj gem).
require 'xcodeproj'

root = File.expand_path('../ios/App', __dir__)
project = Xcodeproj::Project.open(File.join(root, 'App.xcodeproj'))
app = project.targets.find { |t| t.name == 'App' } or abort('App target not found')
group = project.main_group.children.find { |g| g.respond_to?(:path) && g.path == 'App' } or abort('App group not found')

Dir.children(File.join(root, 'App')).select { |f| f.start_with?('AR') && f.end_with?('.swift') }.sort.each do |name|
  ref = group.files.find { |f| f.path == name } || group.new_reference(name)
  app.source_build_phase.add_file_reference(ref, true) unless app.source_build_phase.files_references.include?(ref)
end

%w[ARKit Vision].each do |fw|
  path = "System/Library/Frameworks/#{fw}.framework"
  next if app.frameworks_build_phase.files_references.any? { |r| r&.path == path }
  ref = project.frameworks_group.files.find { |f| f.path == path } || project.frameworks_group.new_reference(path, :sdk_root)
  app.frameworks_build_phase.add_file_reference(ref, true)
end

project.save
puts "AR sources ready: #{app.source_build_phase.files_references.map(&:path).grep(/^AR/).join(', ')}"
