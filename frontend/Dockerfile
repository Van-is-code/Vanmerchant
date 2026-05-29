FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

RUN cat > /etc/nginx/conf.d/default.conf <<'EOF'
server {
	listen 80;
	server_name _;

	root /usr/share/nginx/html;
	index index.html;

	location /api/events {
		proxy_pass http://backend:2026/api/events;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_set_header Connection '';
		proxy_buffering off;
		proxy_cache off;
		chunked_transfer_encoding off;
		proxy_read_timeout 3600s;
	}

	location /api/ {
		proxy_pass http://backend:2026/api/;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Real-IP $remote_addr;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
	}

	location / {
		try_files $uri $uri/ /index.html;
	}
}
EOF

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
