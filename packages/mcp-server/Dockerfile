FROM node:20-alpine

# Install the package globally
RUN npm install -g @katok-mcp/mcp-server

# Expose HTTP port
EXPOSE 3000

# Default: run HTTP server
# Override CMD to run in stdio mode if needed
CMD ["katok-mcp", "server", "--http", "--port", "3000"]