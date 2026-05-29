#!/bin/bash
kill $(lsof -ti:3022 -ti:3033) 2>/dev/null
echo "All servers killed"
