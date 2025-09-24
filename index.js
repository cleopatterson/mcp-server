// index.js
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Simple MCP Server implementation
const mcpServer = {
  name: "painterjobs-mcp",
  version: "1.0.0"
};

// Define available tools
const tools = [
  {
    name: "test_echo",
    description: "A simple test tool that echoes a message",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Message to echo back",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "service_seeking_price_estimator",
    description: "Estimate painting price from description",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Job description (e.g., 'paint 2 bedroom interior')",
          minLength: 5,
        },
        postcode: {
          type: "string",
          description: "Job postcode (optional)",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "calculate_room_paint",
    description: "Calculate paint needed for a room",
    inputSchema: {
      type: "object",
      properties: {
        length: {
          type: "number",
          description: "Room length in meters",
        },
        width: {
          type: "number",
          description: "Room width in meters",
        },
        height: {
          type: "number",
          description: "Room height in meters",
        },
      },
      required: ["length", "width", "height"],
    },
  },
];

// Tool implementations
function handleToolCall(name, args) {
  switch (name) {
    case "test_echo":
      return {
        content: [
          {
            type: "text",
            text: `Echo: ${args.message}\nTimestamp: ${new Date().toISOString()}`,
          },
        ],
      };

    case "service_seeking_price_estimator":
      const description = args.description.toLowerCase();
      let basePrice = 500;
      let days = 1;

      // Simple keyword-based pricing
      if (description.includes("room") || description.includes("bedroom")) {
        basePrice += 300;
        days = 1;
      }
      if (description.includes("2") || description.includes("two")) {
        basePrice += 300;
        days = 2;
      }
      if (description.includes("3") || description.includes("three")) {
        basePrice += 600;
        days = 3;
      }
      if (description.includes("house") || description.includes("home")) {
        basePrice += 2000;
        days = 5;
      }
      if (description.includes("exterior") || description.includes("outside")) {
        basePrice += 1500;
        days += 2;
      }
      if (description.includes("ceiling")) {
        basePrice += 200;
      }
      if (description.includes("apartment") || description.includes("unit")) {
        basePrice += 1000;
        days = 3;
      }

      const minPrice = Math.round(basePrice * 0.8);
      const maxPrice = Math.round(basePrice * 1.2);

      let priceResponse = `🎨 Painting Price Estimate\n`;
      priceResponse += `━━━━━━━━━━━━━━━━━━━━\n`;
      priceResponse += `Description: ${args.description}\n`;
      if (args.postcode) {
        priceResponse += `Location: Postcode ${args.postcode}\n`;
      }
      priceResponse += `\n💰 Estimated Price Range: $${minPrice} - $${maxPrice}\n`;
      priceResponse += `⏱️ Estimated Duration: ${days} day${days > 1 ? 's' : ''}\n`;
      priceResponse += `\n📝 Note: This is a rough estimate. Actual prices vary based on:\n`;
      priceResponse += `• Surface preparation needed\n`;
      priceResponse += `• Paint quality selected\n`;
      priceResponse += `• Accessibility and room layout\n`;
      priceResponse += `• Current condition of surfaces`;

      return {
        content: [
          {
            type: "text",
            text: priceResponse,
          },
        ],
      };

    case "calculate_room_paint":
      const { length, width, height } = args;

      // Calculate wall area (perimeter × height minus standard door/window area)
      const perimeter = 2 * (length + width);
      const wallArea = perimeter * height;
      const doorWindowArea = 4; // Approximate m² for standard door and window
      const paintableArea = wallArea - doorWindowArea;

      // Calculate ceiling area
      const ceilingArea = length * width;

      // Paint coverage (1 liter typically covers 10m² for one coat)
      const coveragePerLiter = 10;
      const coats = 2;

      const wallPaintNeeded = (paintableArea * coats) / coveragePerLiter;
      const ceilingPaintNeeded = (ceilingArea * coats) / coveragePerLiter;

      let calculatorResponse = `🎨 Paint Calculator Results\n`;
      calculatorResponse += `━━━━━━━━━━━━━━━━━━━━\n`;
      calculatorResponse += `Room Dimensions: ${length}m × ${width}m × ${height}m\n\n`;
      calculatorResponse += `📐 Areas:\n`;
      calculatorResponse += `• Wall area: ${paintableArea.toFixed(1)}m²\n`;
      calculatorResponse += `• Ceiling area: ${ceilingArea.toFixed(1)}m²\n\n`;
      calculatorResponse += `🪣 Paint Required (2 coats):\n`;
      calculatorResponse += `• Walls: ${Math.ceil(wallPaintNeeded)} liters\n`;
      calculatorResponse += `• Ceiling: ${Math.ceil(ceilingPaintNeeded)} liters\n`;
      calculatorResponse += `• Total: ${Math.ceil(wallPaintNeeded + ceilingPaintNeeded)} liters\n\n`;
      calculatorResponse += `💡 Tip: Add 10% extra for touch-ups and future maintenance`;

      return {
        content: [
          {
            type: "text",
            text: calculatorResponse,
          },
        ],
      };

    default:
      return {
        error: `Unknown tool: ${name}`,
      };
  }
}

// MCP Protocol Endpoints
app.all("/mcp", async (req, res) => {
  try {
    // Handle GET requests (connection test)
    if (req.method === 'GET') {
      console.log("GET request to /mcp - returning server info");
      return res.json({
        name: mcpServer.name,
        version: mcpServer.version,
        protocolVersion: "2025-06-18",
        capabilities: {
          tools: true
        },
        status: "ready"
      });
    }

    // Handle POST requests
    const { method, params } = req.body || {};

    console.log(`MCP Request: ${method}`, params);

    switch (method) {
      case "initialize":
        // Handle MCP initialization handshake
        res.json({
          protocolVersion: "2025-06-18",
          capabilities: {
            tools: {
              listChanged: false
            }
          },
          serverInfo: {
            name: mcpServer.name,
            version: mcpServer.version
          }
        });
        break;

      case "tools/list":
      case "list_tools":
      case "listTools":
        res.json({ tools });
        break;

      case "tools/call":
      case "call_tool":
      case "callTool":
        const toolParams = params || {};
        const result = handleToolCall(
          toolParams.name || toolParams.tool_name, 
          toolParams.arguments || toolParams.args || {}
        );
        if (result.error) {
          res.status(400).json({ error: result.error });
        } else {
          res.json(result);
        }
        break;

      case "ping":
        // Some MCP clients send ping to check connection
        res.json({ pong: true, timestamp: new Date().toISOString() });
        break;

      default:
        // If no method specified, assume it's a connection test
        if (!method) {
          res.json({
            name: mcpServer.name,
            version: mcpServer.version,
            protocolVersion: "2025-06-18",
            capabilities: {
              tools: true
            },
            status: "ready"
          });
        } else {
          res.status(400).json({ error: `Unsupported method: ${method}` });
        }
    }
  } catch (error) {
    console.error("MCP request error:", error);
    res.status(500).json({ 
      error: error.message || "Internal server error" 
    });
  }
});

// OPTIONS for CORS preflight
app.options("/mcp", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.sendStatus(200);
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    server: mcpServer.name, 
    version: mcpServer.version,
    timestamp: new Date().toISOString()
  });
});

// Root endpoint with API documentation
app.get("/", (req, res) => {
  res.json({
    message: "🎨 PainterJobs MCP Server",
    version: mcpServer.version,
    protocolVersion: "2025-06-18",
    endpoints: {
      "GET /": "This documentation",
      "GET /health": "Health check",
      "GET /mcp": "MCP server info",
      "POST /mcp": "MCP protocol endpoint",
    },
    tools: tools.map(t => ({
      name: t.name,
      description: t.description
    })),
    mcp_methods: [
      "initialize - Handshake with MCP client",
      "tools/list - Get available tools",
      "tools/call - Execute a tool"
    ],
    voiceflow_config: {
      url: "https://get-tools-cleopatterson.replit.app/mcp",
      headers: {
        "Content-Type": "application/json"
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MCP Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📍 API docs: http://localhost:${PORT}/`);
  console.log(`📍 MCP endpoint: http://localhost:${PORT}/mcp`);
});