#!/usr/bin/env node

const nginxTemplate = {
  header: {
    contract_id: "{{contract_id}}",
    hfc_version: "1.0",
    template_slug: "hamayni.nginx.standalone",
    template_version: "1.0.0",
    created_at: "{{created_at}}",
    forged_by: "demo",
    description: "Install and configure Nginx web server",
    tags: ["nginx", "web", "server"]
  },
  gates: [
    {
      id: "check-os",
      description: "Verify Ubuntu/Debian OS",
      operator: "command_ok",
      command: "command -v apt-get",
      target: "apt-get",
      on_failure: "abort",
      error_message: "This contract requires Ubuntu/Debian (apt-get not found)"
    },
    {
      id: "check-port-80",
      description: "Verify port 80 is free",
      operator: "port_free",
      target: "80",
      on_failure: "warn",
      error_message: "Port 80 is already in use - Nginx may fail to start"
    }
  ],
  bom: [
    {
      id: "nginx-config",
      path: "/etc/nginx/sites-available/{{domain}}",
      content: `server {
    listen 80;
    server_name {{domain}} www.{{domain}};

    root /var/www/{{domain}};
    index index.html index.htm;

    location / {
        try_files $uri $uri/ =404;
    }

    access_log /var/log/nginx/{{domain}}_access.log;
    error_log /var/log/nginx/{{domain}}_error.log;
}`,
      mode: "0644",
      owner: "root:root",
      create_parents: true,
      description: "Nginx site configuration"
    },
    {
      id: "dir-webroot",
      path: "/var/www/{{domain}}",
      content: "",
      mode: "0755",
      owner: "www-data:www-data",
      create_parents: true,
      description: "Web root directory"
    },
    {
      id: "index-html",
      path: "/var/www/{{domain}}/index.html",
      content: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to {{domain}}</title>
</head>
<body>
    <h1>HAMAYNI Infrastructure - {{domain}}</h1>
    <p>This site is powered by HAMAYNI Contract Engine v3.1</p>
</body>
</html>`,
      mode: "0644",
      owner: "www-data:www-data",
      create_parents: true,
      description: "Default homepage"
    }
  ],
  operations: [
    {
      id: "update-apt",
      order: 1,
      type: "apt",
      description: "Update package lists",
      command: "apt-get update -qq",
      timeout: 300,
      retries: 2,
      retry_delay: 10
    },
    {
      id: "install-nginx",
      order: 2,
      type: "apt",
      description: "Install Nginx web server",
      command: "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx",
      timeout: 600,
      retries: 2,
      retry_delay: 10
    },
    {
      id: "enable-site",
      order: 3,
      type: "shell",
      description: "Enable Nginx site configuration",
      command: "ln -sf /etc/nginx/sites-available/{{domain}} /etc/nginx/sites-enabled/{{domain}}",
      ignore_errors: false
    },
    {
      id: "test-config",
      order: 4,
      type: "systemctl",
      description: "Test Nginx configuration",
      command: "nginx -t",
      ignore_errors: false,
      failure_message: "Nginx configuration test failed"
    },
    {
      id: "reload-nginx",
      order: 5,
      type: "systemctl",
      description: "Reload Nginx service",
      command: "systemctl reload nginx || systemctl restart nginx",
      success_message: "Nginx reloaded successfully"
    },
    {
      id: "enable-nginx",
      order: 6,
      type: "systemctl",
      description: "Enable Nginx on boot",
      command: "systemctl enable nginx",
      success_message: "Nginx enabled on boot"
    }
  ]
};

console.log(JSON.stringify(nginxTemplate, null, 2));
