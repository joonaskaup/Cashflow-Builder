#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
unset PYTHONHOME PYTHONPATH NODE_OPTIONS
if [[ ! -x /usr/bin/sandbox-exec ]]; then
  print "This Mac does not have the required local network sandbox. The app has not started."
  read "?Press Return to close."
  exit 1
fi
exec /usr/bin/sandbox-exec -f "$PWD/offline.sb" "$PWD/runtime/python/bin/python3" -I "$PWD/local_app.py"
