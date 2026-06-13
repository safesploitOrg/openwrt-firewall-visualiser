#!/bin/sh
uci show firewall | grep -E "\.(name|network)="
uci show network | grep -E "\.(ipaddr|netmask)="