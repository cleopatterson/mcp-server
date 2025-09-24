// index.js
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Simple MCP Server implementation
const mcpServer = {
  name: "painterjobs-mcp",
  version: "0.1.0"
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

      let response = `🎨 Painting Price Estimate\n`;
      response += `━━━━━━━━━━━━━━━━━━━━\n`;
      response += `Description: ${args.description}\n`;
      if (args.postcode) {
        response += `Location: Postcode ${args.postcode}\n`;
      }
      response += `\n💰 Estimated Price Range: $${minPrice} - $${maxPrice}\n`;
      response += `⏱️ Estimated Duration: ${days} day${days > 1 ? 's' : ''}\n`;
      response += `\n📝 Note: This is a rough estimate. Actual prices vary based on:\n`;
      response += `• Surface preparation needed\n`;
      response += `• Paint quality selected\n`;
      response += `• Accessibility and room layout\n`;
      response += `• Current condition of surfaces`;

      return {
        content: [
          {
            type: "text",
            text: response,
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

      let response = `🎨 Paint Calculator Results\n`;
      response += `━━━━━━━━━━━━━━━━━━━━\n`;
      response += `Room Dimensions: ${length}m × ${width}m × ${height}m\n\n`;
      response += `📐 Areas:\n`;
      response += `• Wall area: ${paintableArea.toFixed(1)}m²\n`;
      response += `• Ceiling area: ${ceilingArea.toFixed(1)}m²\n\n`;
      response += `🪣 Paint Required (2 coats):\n`;
      response += `• Walls: ${Math.ceil(wallPaintNeeded)} liters\n`;
      response += `• Ceiling: ${Math.ceil(ceilingPaintNeeded)} liters\n`;
      response += `• Total: ${Math.ceil(wallPaintNeeded + ceilingPaintNeeded)} liters\n\n`;
      response += `💡 Tip: Add 10% extra for touch-ups and future maintenance`;

      return {
        content: [
          {
            type: "text",
            text: response,
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
app.post("/mcp", async (req, res) => {
  try {
    const { method, params } = req.body;

    console.log(`MCP Request: ${method}`, params);

    switch (method) {
      case "tools/list":
        res.json({ tools });
        break;

      case "tools/call":
        const result = handleToolCall(params.name, params.arguments || {});
        if (result.error) {
          res.status(400).json({ error: result.error });
        } else {
          res.json(result);
        }
        break;

      default:
        res.status(400).json({ error: `Unsupported method: ${method}` });
    }
  } catch (error) {
    console.error("MCP request error:", error);
    res.status(500).json({ 
      error: error.message || "Internal server error" 
    });
  }
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
    endpoints: {
      "GET /": "This documentation",
      "GET /health": "Health check",
      "POST /mcp": "MCP protocol endpoint",
    },
    tools: tools.map(t => ({
      name: t.name,
      description: t.description
    })),
    examples: [
      {
        description: "List all tools",
        method: "POST",
        url: "/mcp",
        body: {
          method: "tools/list",
          params: {}
        }
      },
      {
        description: "Estimate painting price",
        method: "POST",
        url: "/mcp",
        body: {
          method: "tools/call",
          params: {
            name: "service_seeking_price_estimator",
            arguments: {
              description: "paint 3 bedroom house interior",
              postcode: "2093"
            }
          }
        }
      }
    ]
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MCP Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📍 API docs: http://localhost:${PORT}/`);
});