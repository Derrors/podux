package buildinfo

// AppVersion is the application version. Release builds set it from the git tag
// with -ldflags "-X podux/pkg/buildinfo.AppVersion=1.2.3"; this default is used otherwise.
var AppVersion = "0.2.2"
