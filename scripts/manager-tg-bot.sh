#!/bin/bash

# Configuration
CONFIG_DIR="/root/wireguard-manager/configs"
WG_INTERFACE="wg0"
mkdir -p "$CONFIG_DIR"

# Helper to output JSON error and exit
exit_error() {
    echo "{\"success\": false, \"error\": \"$1\"}"
    exit 1
}

# Helper to output JSON success
exit_success() {
    local message=$1
    shift
    local extra_fields=""
    for field in "$@"; do
        extra_fields="$extra_fields, $field"
    done
    echo "{\"success\": true, \"message\": \"$message\"$extra_fields}"
    exit 0
}

# Get Server Info
get_server_info() {
    SERVER_PUB=$(wg show "$WG_INTERFACE" public-key 2>/dev/null)
    [[ -z "$SERVER_PUB" ]] && exit_error "WireGuard interface $WG_INTERFACE not found or not running"
    
    PORT=$(wg show "$WG_INTERFACE" listen-port 2>/dev/null)
    # Try to get public IP
    PUBLIC_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
}

case "$1" in
    create)
        # Usage: create <name> <priv_key> <pub_key> <ip>
        NAME=$2
        CLIENT_PRIV=$3
        CLIENT_PUB=$4
        CLIENT_IP=$5

        [[ -z "$NAME" || -z "$CLIENT_PRIV" || -z "$CLIENT_PUB" || -z "$CLIENT_IP" ]] && exit_error "Usage: create <name> <priv_key> <pub_key> <ip>"
        
        get_server_info
        
        # Create config file
        cat <<EOC > "$CONFIG_DIR/$NAME.conf"
[Interface]
PrivateKey = $CLIENT_PRIV
Address = $CLIENT_IP/32
DNS = 1.1.1.1

[Peer]
PublicKey = $SERVER_PUB
Endpoint = $PUBLIC_IP:$PORT
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
EOC

        # Add peer to WireGuard
        wg set "$WG_INTERFACE" peer "$CLIENT_PUB" allowed-ips "$CLIENT_IP/32" || exit_error "Failed to add peer to WireGuard"
        
        exit_success "Config created" "\"config_path\": \"$CONFIG_DIR/$NAME.conf\"", "\"name\": \"$NAME\"", "\"ip\": \"$CLIENT_IP\""
        ;;

    list)
        # List all configs
        FILES=$(ls -1 "$CONFIG_DIR"/*.conf 2>/dev/null | xargs -n1 basename | sed 's/\.conf//g')
        # Convert to JSON array
        JSON_FILES=$(echo "$FILES" | jq -R . | jq -s . 2>/dev/null || echo "[]")
        # If jq is not installed, manual fallback
        if ! command -v jq &> /dev/null; then
            JSON_FILES="["
            first=true
            for f in $FILES; do
                [[ "$first" == false ]] && JSON_FILES="$JSON_FILES, "
                JSON_FILES="$JSON_FILES\"$f\""
                first=false
            done
            JSON_FILES="$JSON_FILES]"
        fi
        echo "{\"success\": true, \"configs\": $JSON_FILES}"
        ;;

    delete)
        NAME=$2
        [[ -z "$NAME" ]] && exit_error "Usage: delete <name>"
        FILE="$CONFIG_DIR/$NAME.conf"
        [[ ! -f "$FILE" ]] && exit_error "Config $NAME.conf not found"

        # Extract PrivateKey from file and generate PublicKey to remove from WG
        # (Since we don't store the public key in the file usually, but we can derive it)
        PRIV_KEY=$(grep "PrivateKey" "$FILE" | awk '{print $3}')
        [[ -z "$PRIV_KEY" ]] && exit_error "Could not find PrivateKey in config file"
        
        PUB_TO_REMOVE=$(echo "$PRIV_KEY" | wg pubkey)
        
        # Remove from WG
        wg set "$WG_INTERFACE" peer "$PUB_TO_REMOVE" remove || exit_error "Failed to remove peer from WireGuard"
        
        # Delete file
        rm "$FILE"
        
        exit_success "Device $NAME deleted"
        ;;

    status)
        # Get WG status in JSON
        # interface: <pubkey> <privkey> <port> <fwmark>
        # peer: <pubkey> <psk> <endpoint> <allowed_ips> <handshake> <rx> <tx> <keepalive>
        
        get_server_info
        
        DUMP=$(wg show "$WG_INTERFACE" dump 2>/dev/null)
        [[ -z "$DUMP" ]] && exit_error "Failed to get WireGuard status"

        # Manual JSON construction to avoid dependency on jq for core logic
        PEERS_JSON="["
        first_peer=true
        
        # Skip first line (interface info)
        while read -r line; do
            [[ -z "$line" ]] && continue
            # If it's the interface line (no endpoint/allowed_ips), skip
            # Actually, wg show dump output:
            # line 1: interface
            # line 2+: peers
            
            # Check if it's a peer line (at least 4 fields)
            fields=($line)
            if [[ ${#fields[@]} -gt 4 ]]; then
                [[ "$first_peer" == false ]] && PEERS_JSON="$PEERS_JSON, "
                
                PUB=${fields[0]}
                ENDPOINT=${fields[2]}
                IPS=${fields[3]}
                HANDSHAKE=${fields[4]}
                RX=${fields[5]}
                TX=${fields[6]}
                
                PEERS_JSON="$PEERS_JSON{\"public_key\": \"$PUB\", \"endpoint\": \"$ENDPOINT\", \"allowed_ips\": \"$IPS\", \"latest_handshake\": $HANDSHAKE, \"transfer_rx\": $RX, \"transfer_tx\": $TX}"
                first_peer=false
            fi
        done <<< "$(echo "$DUMP" | tail -n +2)"
        PEERS_JSON="$PEERS_JSON]"

        echo "{\"success\": true, \"interface\": \"$WG_INTERFACE\", \"public_key\": \"$SERVER_PUB\", \"listen_port\": $PORT, \"peers\": $PEERS_JSON}"
        ;;

    check_ip)
        # Find max IP in existing configs
        USED_IPS=$(grep -r "Address" "$CONFIG_DIR" 2>/dev/null | grep -oE "10\.7\.0\.[0-9]+" | cut -d. -f4)
        MAX_IP=$(echo "$USED_IPS" | sort -n | tail -1)
        [[ -z "$MAX_IP" ]] && MAX_IP=1
        
        echo "{\"success\": true, \"last_ip\": \"10.7.0.$MAX_IP\", \"next_ip\": \"10.7.0.$((MAX_IP + 1))\"}"
        ;;

    *)
        exit_error "Unknown command: $1. Available: create, list, delete, status, check_ip"
        ;;
esac
