#!/bin/bash
kill $(lsof -ti:3022 -ti:3000 -ti:3033 -ti:3001 -ti:8080 -ti:5000) 2>/dev/null
echo "All servers killed"
