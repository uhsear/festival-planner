#!/usr/bin/env bash

set -u

adb install -r packages/mobile/android/app/build/outputs/apk/release/app-release.apk || exit $?
adb logcat -c || exit $?
cd packages/mobile || exit $?

maestro_rc=1
for attempt in 1 2; do
  MAESTRO_CLI_NO_ANALYTICS=1 maestro test \
    -e TEST_USERNAME="$TEST_USERNAME" \
    -e TEST_PASSWORD="$TEST_PASSWORD" \
    --test-output-dir="$PWD/maestro-debug" \
    --debug-output="$PWD/maestro-debug" \
    --flatten-debug-output \
    --format junit --output maestro-report.xml \
    .maestro/android-smoke.yaml
  maestro_rc=$?
  [ "$maestro_rc" -eq 0 ] && break

  if [ "$attempt" -lt 2 ]; then
    echo "::warning::Maestro attempt $attempt failed (rc=$maestro_rc) — retrying once after 20 s"
    sleep 20
    adb logcat -c
  fi
done

adb logcat -d ReactNativeJS:V AndroidRuntime:E ReactNative:W '*:S' > logcat-rn.txt || true
exit "$maestro_rc"
