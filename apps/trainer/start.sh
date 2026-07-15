#!/usr/bin/env sh
cd "$(dirname "$0")"
( sleep 1; printf "Open http://localhost:8000\n" ) &
python3 -m http.server 8000
