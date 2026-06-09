#!/bin/sh
# 
# Expected output format: ip,hostname,zone,mac
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

cidr_to_mask() {
	bits="$1"
	mask=$((0xffffffff << (32 - bits) & 0xffffffff))
	echo "$mask"
}

ip_in_cidr() {
	ip="$1"
	cidr="$2"

	net="${cidr%/*}"
	bits="${cidr#*/}"

	ip_int="$(ip_to_int "$ip")"
	net_int="$(ip_to_int "$net")"
	mask_int="$(cidr_to_mask "$bits")"

	[ $((ip_int & mask_int)) -eq $((net_int & mask_int)) ]
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
			[ -z "$netmask" ] && netmask="255.255.255.0"

			case "$netmask" in
				255.255.255.0) cidr="$ipaddr/24" ;;
				255.255.0.0) cidr="$ipaddr/16" ;;
				255.0.0.0) cidr="$ipaddr/8" ;;
				*) cidr="$ipaddr/24" ;;
			esac

			network_base="$(echo "$cidr" | awk -F. '{print $1"."$2"."$3".0/24"}')"

			if ip_in_cidr "$ip" "$network_base"; then
				echo "$zone_name"
				return
			fi
		done
	done

	echo "unknown"
}

printf "ip,hostname,zone,mac\n"

cat "$LEASES_FILE" | while read -r expiry mac ip hostname clientid; do
	zone="$(get_zone_for_ip "$ip")"

	[ -z "$hostname" ] && hostname="unknown"

	printf "%s,%s,%s,%s\n" "$ip" "$hostname" "$zone" "$mac"
done