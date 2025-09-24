// index.js
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Log all requests for debugging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.body) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

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
  console.log(`Calling tool: ${name} with args:`, args);

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
      const perimeter = 2 * (parseFloat(length) + parseFloat(width));
      const wallArea = perimeter * parseFloat(height);
      const doorWindowArea = 4; // Approximate m² for standard door and window
      const paintableArea = wallArea - doorWindowArea;

      // Calculate ceiling area
      const ceilingArea = parseFloat(length) * parseFloat(width);

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

// Main MCP endpoint - handle both GET and POST
app.all("/mcp", async (req, res) => {
  try {
    // Handle GET requests
    if (req.method === 'GET') {
      console.log("GET /mcp - returning tools list");
      return res.json({ 
        tools: tools,
        server: mcpServer.name,
        version: mcpServer.version
      });
    }

    // Handle POST requests
    const { method, params, id } = req.body || {};

    console.log(`MCP POST Request: ${method}`);
    if (params) {
      console.log('Parameters:', JSON.stringify(params, null, 2));
    }

    // Build response with id if provided (JSONRPC style)
    const response = (data) => {
      if (id !== undefined) {
        return { ...data, id };
      }
      return data;
    };

    switch (method) {
      case "initialize":
        console.log("Handling initialize request");
        return res.json(response({
          protocolVersion: "2025-06-18",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: mcpServer.name,
            version: mcpServer.version
          }
        }));

      case "tools/list":
        console.log("Handling tools/list request");
        return res.json(response({
          tools: tools
        }));

      case "tools/call":
        console.log("Handling tools/call request");
        const toolParams = params || {};
        const result = handleToolCall(
          toolParams.name, 
          toolParams.arguments || {}
        );
        if (result.error) {
          return res.status(400).json(response({ 
            error: { 
              message: result.error 
            } 
          }));
        }
        return res.json(response(result));

      case "ping":
        console.log("Handling ping request");
        return res.json(response({ 
          pong: true, 
          timestamp: new Date().toISOString() 
        }));

      default:
        console.log(`Unknown method: ${method}`);
        return res.status(400).json(response({ 
          error: { 
            message: `Unsupported method: ${method}` 
          } 
        }));
    }
  } catch (error) {
    console.error("MCP request error:", error);
    res.status(500).json({ 
      error: { 
        message: error.message || "Internal server error" 
      }
    });
  }
});

// Additional endpoints Voiceflow might try
app.post("/", async (req, res) => {
  console.log("POST to root / - redirecting to /mcp");
  req.url = '/mcp';
  app.handle(req, res);
});

app.get("/mcp/tools", (req, res) => {
  console.log("GET /mcp/tools");
  res.json({ tools });
});

app.post("/mcp/tools", (req, res) => {
  console.log("POST /mcp/tools");
  res.json({ tools });
});

// OPTIONS for CORS preflight
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.sendStatus(200);
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    server: mcpServer.name, 
    version: mcpServer.version,
    timestamp: new Date().toISOString(),
    tools_count: tools.length
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
      "GET /mcp": "Get tools list",
      "POST /mcp": "MCP protocol endpoint",
    },
    tools: tools.map(t => ({
      name: t.name,
      description: t.description
    })),
    test_with_curl: {
      list_tools: `curl -X POST ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : 'http://localhost:3000'}/mcp -H "Content-Type: application/json" -d '{"method":"tools/list"}'`,
      call_tool: `curl -X POST ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : 'http://localhost:3000'}/mcp -H "Content-Type: application/json" -d '{"method":"tools/call","params":{"name":"test_echo","arguments":{"message":"Hello"}}}'`
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MCP Server running on port ${PORT}`);
  console.log(`📍 Server URL: ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : `http://localhost:${PORT}`}`);
  console.log(`📍 Check health: ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : `http://localhost:${PORT}`}/health`);
});