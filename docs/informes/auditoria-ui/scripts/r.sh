#!/bin/sh
# Envía el cuerpo JS (stdin) al driver
curl -s -X POST --data-binary @- http://127.0.0.1:9333/run
