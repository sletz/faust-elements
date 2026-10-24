#!/bin/sh
# The certificates the phone apps are served with on the local network
# (make pwa-cert): a local authority, made once, and a certificate it signs for
# this machine's address on the network (made again when the address changes).
#
#   sh scripts/pwa_cert.sh [IP]
#
# Writes build/pwa-cert/: ca.key, ca.crt (the authority, to install on the
# phone), server.key, server.crt, ip.txt. The authority is limited by name
# constraints to private addresses and .local names: trusted on a phone, it can
# certify nothing on the internet. Its key never leaves build/ (not committed).
set -e
dir=build/pwa-cert
mkdir -p "$dir"
ip=${1:-$(python3 -c 'import socket; s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(("192.0.2.1", 9)); print(s.getsockname()[0])')}
host=$(scutil --get LocalHostName 2>/dev/null || hostname -s).local

if [ ! -f "$dir/ca.key" ]; then
  cat > "$dir/ca.cnf" <<EOF
[req]
distinguished_name = dn
[dn]
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical, permitted;IP:10.0.0.0/255.0.0.0, permitted;IP:172.16.0.0/255.240.0.0, permitted;IP:192.168.0.0/255.255.0.0, permitted;IP:127.0.0.0/255.0.0.0, permitted;DNS:.local, permitted;DNS:localhost
EOF
  openssl genrsa -out "$dir/ca.key" 2048 2>/dev/null
  openssl req -x509 -new -key "$dir/ca.key" -sha256 -days 825 \
    -subj "/CN=faust-elements local authority ($(hostname -s))" \
    -config "$dir/ca.cnf" -extensions v3_ca -out "$dir/ca.crt"
  echo "new authority: $dir/ca.crt (install it on the phone once)"
fi

cat > "$dir/server.cnf" <<EOF
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = IP:$ip, DNS:$host, DNS:localhost
EOF
openssl genrsa -out "$dir/server.key" 2048 2>/dev/null
openssl req -new -key "$dir/server.key" -subj "/CN=$ip" -out "$dir/server.csr"
# 397 days: what browsers accept of a server certificate.
openssl x509 -req -in "$dir/server.csr" -CA "$dir/ca.crt" -CAkey "$dir/ca.key" -CAcreateserial \
  -days 397 -sha256 -extfile "$dir/server.cnf" -out "$dir/server.crt" 2>/dev/null
echo "$ip" > "$dir/ip.txt"
echo "certificate for $ip and $host: $dir/server.crt (restart make web-serve)"
