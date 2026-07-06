#!/usr/bin/env bash
# Ротация CloudFront key: aws cloudfront create-public-key + update key group
set -euo pipefail
echo "Generate new RSA key, upload to CloudFront, update CLOUDFRONT_KEY_ID in .env"
openssl genrsa -out infra/cloudfront-private-key.pem 2048
openssl rsa -pubout -in infra/cloudfront-private-key.pem -out infra/cloudfront-public-key.pem
echo "Done. Deploy new key ID to CloudFront console."
