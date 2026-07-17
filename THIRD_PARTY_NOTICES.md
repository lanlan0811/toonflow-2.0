# Third-party notices

## FFmpeg / FFprobe runtime

The redraw workflow bundles platform-specific FFmpeg and FFprobe executables through
`@ffmpeg-installer/ffmpeg` 1.1.0 and `@ffprobe-installer/ffprobe` 2.1.2. The installer
packages declare LGPL-2.1. Individual FFmpeg builds can enable additional GPL
components; the bundled executable's `-version` output is the authoritative build
configuration for a packaged platform.

FFmpeg source code and license information: https://ffmpeg.org/legal.html

Installer package sources:

- https://github.com/kribblo/node-ffmpeg-installer
- https://github.com/SavageCore/node-ffprobe-installer
