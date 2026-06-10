#!/bin/sh
#
# Export OpenWrt DHCP leases with inferred firewall zones.
#
# Expected output format:
# ip,hostname,zone,mac
# 172.16.20.10,Alexa-Kitchen,iot,aa:bb:cc:dd:ee:ff
# 172.16.20.11,Alexa-Bedroom,iot,aa:bb:cc:dd:ee:00
# 172.16.30.25,Guest-Phone,guest,aa:bb:cc:dd:ee:11

LEASES_FILE="/tmp/dhcp.leases"

ip_to_int() {
	IFS=. read -r a b c d <<EOF
$1
EOF
	echo $((a * 16777216 + b * 65536 + c * 256 + d))
}

prefix_to_mask() {
	prefix="$1"

	if [ "$prefix" -eq 0 ]; then
		echo 0
		return
	fi

	echo $(((0xffffffff << (32 - prefix)) & 0xffffffff))
}

netmask_to_prefix() {
	mask_int="$(ip_to_int "$1")"
	prefix=0
	bit=31

	while [ "$bit" -ge 0 ]; do
		if [ $((mask_int & (1 << bit))) -ne 0 ]; then
			prefix=$((prefix + 1))
		else
			break
		fi

		bit=$((bit - 1))
	done

	echo "$prefix"
}

ip_in_cidr() {
	ip="$1"
	cidr="$2"

	net="${cidr%/*}"
	bits="${cidr#*/}"

	ip_int="$(ip_to_int "$ip")"
	net_int="$(ip_to_int "$net")"
	mask_int="$(prefix_to_mask "$bits")"

	[ $((ip_int & mask_int)) -eq $((net_int & mask_int)) ]
}

interface_cidr() {
	ipaddr="$1"
	netmask="$2"

	case "$ipaddr" in
		*/*)
			echo "$ipaddr"
			return
			;;
	esac

	[ -z "$netmask" ] && netmask="255.255.255.0"

	prefix="$(netmask_to_prefix "$netmask")"
	ip_int="$(ip_to_int "$ipaddr")"
	mask_int="$(prefix_to_mask "$prefix")"
	net_int=$((ip_int & mask_int))

	a=$(((net_int >> 24) & 255))
	b=$(((net_int >> 16) & 255))
	c=$(((net_int >> 8) & 255))
	d=$((net_int & 255))

	echo "$a.$b.$c.$d/$prefix"
}

get_zone_for_ip() {
	ip="$1"

	for zone_section in $(uci show firewall | grep "=zone" | cut -d. -f2 | cut -d= -f1 | sort -u); do
		zone_name="$(uci -q get firewall."$zone_section".name)"
		networks="$(uci -q get firewall."$zone_section".network)"

		for network_name in $networks; do
			ipaddr="$(uci -q get network."$network_name".ipaddr)"
			netmask="$(uci -q get network."$network_name".netmask)"

			[ -z "$ipaddr" ] && continue
			network_cidr="$(interface_cidr "$ipaddr" "$netmask")"

			if ip_in_cidr "$ip" "$network_cidr"; then
				echo "$zone_name"
				return
			fi
		done
	done

	echo "unknown"
}

printf "ip,hostname,zone,mac\n"

[ -r "$LEASES_FILE" ] || exit 0

while read -r expiry mac ip hostname clientid; do
	[ -z "$ip" ] && continue
	zone="$(get_zone_for_ip "$ip")"

	[ -z "$hostname" ] && hostname="unknown"
	[ "$hostname" = "*" ] && hostname="unknown"

	printf "%s,%s,%s,%s\n" "$ip" "$hostname" "$zone" "$mac"
done < "$LEASES_FILE"
