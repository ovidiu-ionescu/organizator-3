JWT=$(curl "http://127.0.0.1:3000/login" -H "Content-Type: application/x-www-form-urlencoded" -d "username=admin&password=admin")
echo $JWT
curl -v -H "Authorization: Bearer $JWT" "http://127.0.0.1:3000/call"


