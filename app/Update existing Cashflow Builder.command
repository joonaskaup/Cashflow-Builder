#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
unset PYTHONHOME PYTHONPATH
exec "$PWD/runtime/python/bin/python3" -I "$PWD/update_app.py"
