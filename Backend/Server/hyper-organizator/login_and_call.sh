HOST=127.0.0.1:3000
HOST=127.0.0.1:8080

JWT=$(curl "http://${HOST}/login" -H "Content-Type: application/x-www-form-urlencoded" -d "username=admin&password=admin")
echo $JWT
curl -v -H "Authorization: Bearer $JWT" "http://${HOST}/call"


