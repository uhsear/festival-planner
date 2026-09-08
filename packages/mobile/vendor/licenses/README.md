# Checked-in upstream license texts

scripts/vendor-map-runtime.mjs reads a license from the package's own tarball
first. Some tarballs ship no license file. For those, put the upstream text here
as `<package>-LICENSE.txt` and the generator picks it up, so vendor/LICENSES.md
stays generated and the script needs no network access.

Copy the text verbatim. Do not edit it, and do not write a copyright line that
the upstream project did not publish.

| File | Source | Fetched |
| --- | --- | --- |
| `pmtiles-LICENSE.txt` | https://raw.githubusercontent.com/protomaps/PMTiles/main/LICENSE | 2026-09-08 |

Refresh a file when the dependency is bumped.
