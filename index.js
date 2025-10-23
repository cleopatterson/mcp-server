#!/usr/bin/env node

/**
 * Service Seeking MCP Server - HTTP Version
 * Express server with MCP protocol support (no MCP SDK server handlers)
 */

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN || "";
const POSTCODE_URL = "https://raw.githubusercontent.com/cleopatterson/service_seeking/main/postcode_to_region_area.json";

// Valid service types for painting
const VALID_SERVICES = [
  "Exterior House Painting",
  "Interior House Painting", 
  "Roof Painting",
  "Wallpapering",
  "Commercial Painting",
  "Fence Painting",
  "Paint Removal",
  "House Painting",
  "Floor Painting",
  "Concrete Painting"
];

// Region mapping for expanded search
const REGION_MAPPING = {
  "Western Sydney": ["Western Sydney"],
  "Greater Sydney": ["Greater Sydney", "Northern Sydney"],
  "South Sydney": ["South Sydney", "Sydney Metro"],
  "Sydney Metro": ["Sydney Metro", "South Sydney"],
  "Northern Sydney": ["Northern Sydney", "Greater Sydney"]
};

// Define tools array for reference
const tools = [
  {
    name: "get_top_painters",
    description: "Find the top 3 painters for a specific postcode and painting service type",
    inputSchema: {
      type: "object",
      properties: {
        postcode: {
          type: "string",
          description: "4-digit Australian postcode where painting services are needed",
          pattern: "^[0-9]{4}$"
        },
        service: {
          type: "string",
          description: "Type of painting service required",
          enum: VALID_SERVICES
        },
        hubspot_token: {
          type: "string",
          description: "HubSpot API token (optional - uses HUBSPOT_TOKEN env var if not provided)"
        }
      },
      required: ["postcode", "service"]
    }
  },
  {
    name: "create_job",
    description: "Create a new painting job as a Deal in HubSpot CRM. Use the painting_knowledge_base resource to ask the right questions for job_description and job_size. Customer contact details should be associated separately.",
    inputSchema: {
      type: "object",
      properties: {
        job_description: {
          type: "string",
          description: "Detailed description of the painting job - derived by asking qualifying questions from the painting_knowledge_base resource"
        },
        postcode: {
          type: "string",
          description: "4-digit Australian postcode for the job location",
          pattern: "^[0-9]{4}$"
        },
        subtype: {
          type: "string",
          description: "Service subcategory - must match one of the valid painting services",
          enum: VALID_SERVICES
        },
        customer_type: {
          type: "string",
          description: "Type of customer - 'homeowner' for residential jobs, 'commercial' for business/commercial jobs",
          enum: ["homeowner", "commercial"]
        },
        customer_intent: {
          type: "string",
          description: "Customer's readiness level - derived from how soon they need the job done",
          enum: ["Ready to hire", "Just researching costs"]
        },
        timing: {
          type: "string",
          description: "When the customer needs the job completed",
          enum: ["ASAP", "Within the next 2 weeks", "Within the next month", "Just researching"]
        },
        job_size: {
          type: "string",
          description: "Size/scope of the job - determined using the painting_knowledge_base resource. Note: Some categories skip size collection (Floor Painting, Commercial, Special Tasks) - use 'not_applicable' for these",
          enum: ["small", "medium", "large", "not_applicable"]
        },
        estimate_range: {
          type: "string",
          description: "Price estimate range provided to customer, or 'none provided' if no estimate given"
        },
        preferred_contact_method: {
          type: "string",
          description: "Customer's preferred contact method",
          enum: ["Mobile phone call", "Text message", "Email", "Any"]
        },
        insights_or_red_flags: {
          type: "string",
          description: "Additional insights from conversation including: 1) Budget vs estimate discrepancies if estimate_range was provided, 2) Context like 'preparing for sale', 3) Specific details not in job_description (room sizes, roof area, etc.)"
        },
        budget: {
          type: "string",
          description: "Customer's budget for the job (optional but recommended)"
        },
        customer_availability: {
          type: "string",
          description: "Customer's availability for site visit - required for larger jobs"
        },
        hubspot_token: {
          type: "string",
          description: "HubSpot API token (optional - uses HUBSPOT_TOKEN env var if not provided)"
        }
      },
      required: [
        "job_description",
        "postcode",
        "subtype",
        "customer_type",
        "customer_intent",
        "timing",
        "job_size",
        "estimate_range",
        "preferred_contact_method",
        "insights_or_red_flags"
      ]
    }
  }
];

// Resources for MCP protocol
const resources = [
  {
    uri: "painterjobs://valid-services",
    name: "Valid Painting Services",
    description: "List of exact service types that must be used with get_top_painters",
    mimeType: "application/json"
  },
  {
    uri: "painterjobs://painting-knowledge-base",
    name: "Painting Category Knowledge Base",
    description: "Comprehensive guide for asking questions to determine job_description, job_size, and subcategory classification for painting jobs",
    mimeType: "text/plain"
  }
];

// Tool implementation
async function getTopPainters(args) {
  const postcode = args.postcode;
  const service = args.service;
  const hubspot_token = args.hubspot_token || HUBSPOT_TOKEN;

  // Validation
  if (!postcode || !service || !hubspot_token) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            region: null,
            area: null,
            total_painters: "0",
            top_painters_json: "[]",
            top_painter_1_details: "",
            top_painter_2_details: "",
            top_painter_3_details: "",
            error: "Missing required parameters"
          }, null, 2)
        }
      ]
    };
  }

  let region = null;
  let area = null;

  // Step 1: Postcode → region/area
  try {
    const response = await fetch(POSTCODE_URL);
    if (!response.ok) throw new Error(`Failed to fetch postcode map: ${response.status}`);
    const rawText = await response.text();
    const postcodeMap = JSON.parse(rawText);

    const match = postcodeMap[postcode];
    if (!match) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              region: null,
              area: null,
              total_painters: "0",
              top_painters_json: "[]",
              top_painter_1_details: "",
              top_painter_2_details: "",
              top_painter_3_details: ""
            }, null, 2)
          }
        ]
      };
    }

    region = match.region;
    area = match.area;
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            region: null,
            area: null,
            total_painters: "0",
            top_painters_json: "[]",
            top_painter_1_details: "",
            top_painter_2_details: "",
            top_painter_3_details: "",
            error: err.message
          }, null, 2)
        }
      ]
    };
  }

  // Step 2: Region mapping & HubSpot search (paginated)
  const region_list = REGION_MAPPING[region] || (region ? [region] : []);

  const filterGroups = region_list.map(region_name => ({
    filters: [
      { propertyName: "industries", operator: "CONTAINS_TOKEN", value: "painter" },
      { propertyName: "business_status", operator: "EQ", value: "active" },
      { propertyName: "region", operator: "CONTAINS_TOKEN", value: region_name },
      { propertyName: "services", operator: "CONTAINS_TOKEN", value: service }
    ]
  }));

  const PROPS = [
    "hs_object_id",
    "name",
    "region",
    "area",
    "services",
    "owner_name",
    "mobile_phone_number",
    "ss_profile_url",
    "hs_logo_url",
    "star_rating",
    "number_of_reviews",
    "review_sentiment",
    "jobs_won",
    "job_won",
    "quality_score"
  ];

  async function hsSearchPaginated() {
    const results = [];
    let after = undefined;
    while (true) {
      const body = JSON.stringify({
        filterGroups,
        properties: PROPS,
        limit: 100,
        ...(after ? { after } : {})
      });

      const res = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hubspot_token}`,
          "Content-Type": "application/json"
        },
        body
      });
      if (!res.ok) throw new Error(`HubSpot search failed: ${res.status}`);
      const data = await res.json();

      if (Array.isArray(data.results)) results.push(...data.results);
      after = data.paging?.next?.after;
      if (!after) break;
    }
    return results;
  }

  let companies = [];
  try {
    companies = await hsSearchPaginated();
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            region,
            area,
            total_painters: "0",
            top_painters_json: "[]",
            top_painter_1_details: "",
            top_painter_2_details: "",
            top_painter_3_details: "",
            error: `HubSpot error: ${err.message}`
          }, null, 2)
        }
      ]
    };
  }

  const total_painters = companies.length;

  // Step 3: Shape, sort by HubSpot 'quality_score' (desc)
  function getNumReviews(p) {
    const raw = p["number of reviews"] ?? p.number_of_reviews;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function getJobsWon(p) {
    const raw = p.jobs_won ?? p.job_won ?? p["jobs won"];
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function primaryPhone(p) {
    return (p.mobile_phone_number && p.mobile_phone_number.trim()) ||
           (p.mobilephone && p.mobilephone.trim()) ||
           (p.phone && p.phone.trim()) ||
           null;
  }

  const shaped = companies.map(c => {
    const p = c.properties || {};
    const q = parseFloat(p.quality_score);
    const quality = Number.isFinite(q) ? q : -Infinity;

    return {
      id: p.hs_object_id || c.id,
      company_name: p.name || "Unknown painter",
      region: p.region || null,
      area: p.area || null,
      services: p.services || null,
      owner_name: p.owner_name || "",
      phone: primaryPhone(p),
      ss_profile_url: p.ss_profile_url || null,
      hs_logo_url: p.hs_logo_url || null,
      star_rating: Number.isFinite(parseFloat(p.star_rating)) ? parseFloat(p.star_rating) : 0,
      number_of_reviews: getNumReviews(p),
      review_sentiment: p.review_sentiment || "",
      jobs_won: getJobsWon(p),
      _quality_score: quality
    };
  });

  const top3 = shaped
    .sort((a, b) => (b._quality_score - a._quality_score) || (b.number_of_reviews - a.number_of_reviews))
    .slice(0, 3)
    .map(({ _quality_score, ...rest }) => rest);

  // Step 4: Details strings for AI to verbalize
  function detailString(p) {
    return [
      `owner_name=${p.owner_name}`,
      `company_name=${p.company_name}`,
      `area=${p.area}`,
      `phone=${p.phone}`,
      `jobs_won=${p.jobs_won}`,
      `star_rating=${p.star_rating}`,
      `number_of_reviews=${p.number_of_reviews}`,
      `review_sentiment=${p.review_sentiment}`
    ].join(" | ");
  }

  const d1 = top3[0] ? detailString(top3[0]) : "";
  const d2 = top3[1] ? detailString(top3[1]) : "";
  const d3 = top3[2] ? detailString(top3[2]) : "";

  // Return outputs exactly as Voiceflow expects
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          region,
          area,
          total_painters: String(total_painters),
          top_painters_json: JSON.stringify(top3),
          top_painter_1_details: d1,
          top_painter_2_details: d2,
          top_painter_3_details: d3
        }, null, 2)
      }
    ]
  };
}

// Create Job function - creates a Deal in HubSpot
async function createJob(args) {
  const hubspot_token = args.hubspot_token || HUBSPOT_TOKEN;

  if (!hubspot_token) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "Missing HubSpot API token"
          }, null, 2)
        }
      ]
    };
  }

  // Step 1: Get region and area from postcode
  let region = null;
  let area = null;

  try {
    const response = await fetch(POSTCODE_URL);
    if (!response.ok) throw new Error(`Failed to fetch postcode map: ${response.status}`);
    const rawText = await response.text();
    const postcodeMap = JSON.parse(rawText);

    const match = postcodeMap[args.postcode];
    if (!match) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Invalid postcode: ${args.postcode}`
            }, null, 2)
          }
        ]
      };
    }

    region = match.region;
    area = match.area;
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Postcode lookup failed: ${err.message}`
          }, null, 2)
        }
      ]
    };
  }

  // Step 2: Calculate job_size_weight
  const sizeWeightMap = {
    "small": 1,
    "medium": 2,
    "large": 4,
    "not_applicable": 0
  };
  const job_size_weight = sizeWeightMap[args.job_size] || 0;

  // Step 3: Create dealname from service type
  const dealname = `${args.subtype} - ${area}`;

  // Step 4: Build HubSpot Deal properties
  const dealProperties = {
    dealname: dealname,
    job_description: args.job_description,
    region: region,
    area: area,
    postcode: args.postcode,
    subtype: args.subtype,
    customer_type: args.customer_type,
    customer_intent: args.customer_intent,
    timing: args.timing,
    job_size: args.job_size,
    job_size_weight: String(job_size_weight),
    estimate_range: args.estimate_range,
    preferred_contact_method: args.preferred_contact_method,
    insights_or_red_flags: args.insights_or_red_flags,
    // Default values
    industry: "painter",
    pipeline: "38341498",
    dealstage: "81813617",
    confirmed_company_count: "0",
    rejected_count: "0",
    undelivered_count: "0",
    preferred_number_of_quotes: "5",
    state: "NSW"
  };

  // Add optional fields if provided
  if (args.budget) {
    dealProperties.budget = args.budget;
  }
  if (args.customer_availability) {
    dealProperties.customer_availability = args.customer_availability;
  }

  // Step 5: Create Deal in HubSpot
  try {
    const response = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hubspot_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        properties: dealProperties
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`HubSpot API error ${response.status}: ${errorData}`);
    }

    const dealData = await response.json();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            deal_id: dealData.id,
            dealname: dealname,
            region: region,
            area: area,
            job_size: args.job_size,
            job_size_weight: job_size_weight,
            message: "Job created successfully in HubSpot"
          }, null, 2)
        }
      ]
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Failed to create deal: ${err.message}`
          }, null, 2)
        }
      ]
    };
  }
}

// MCP Protocol Endpoints with JSONRPC 2.0 support
app.post("/mcp", async (req, res) => {
  const { method, params, id } = req.body;

  console.log(`[MCP] ${method}`);

  const respond = (result, error = null) => ({
    jsonrpc: "2.0",
    id,
    ...(error ? { error } : { result })
  });

  try {
    switch (method) {
      case "initialize":
        return res.json(respond({
          protocolVersion: "2025-06-18",
          capabilities: { 
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: "painterjobs-mcp",
            version: "1.0.0"
          }
        }));

      case "tools/list":
        return res.json(respond({ tools }));

      case "resources/list":
        return res.json(respond({ resources }));

      case "resources/read":
        const { uri } = params;
        if (uri === "painterjobs://valid-services") {
          return res.json(respond({
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify({
                  services: VALID_SERVICES,
                  note: "Service parameter must match one of these values EXACTLY"
                }, null, 2)
              }
            ]
          }));
        } else if (uri === "painterjobs://painting-knowledge-base") {
          try {
            const knowledgeBasePath = join(__dirname, "painting_knowledge_base.txt");
            const knowledgeBaseContent = readFileSync(knowledgeBasePath, "utf-8");
            return res.json(respond({
              contents: [
                {
                  uri,
                  mimeType: "text/plain",
                  text: knowledgeBaseContent
                }
              ]
            }));
          } catch (err) {
            return res.json(respond(null, {
              code: -32603,
              message: `Failed to read knowledge base: ${err.message}`
            }));
          }
        } else {
          return res.json(respond(null, {
            code: -32602,
            message: `Unknown resource: ${uri}`
          }));
        }

      case "tools/call":
        const { name, arguments: args } = params;

        if (name === "get_top_painters") {
          const result = await getTopPainters(args || {});
          return res.json(respond(result));
        } else if (name === "create_job") {
          const result = await createJob(args || {});
          return res.json(respond(result));
        } else {
          return res.json(respond(null, {
            code: -32602,
            message: `Unknown tool: ${name}`
          }));
        }

      default:
        return res.json(respond(null, {
          code: -32601,
          message: `Method not found: ${method}`
        }));
    }
  } catch (error) {
    console.error("MCP request error:", error);
    return res.json(respond(null, {
      code: -32603,
      message: error.message || "Internal server error"
    }));
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok",
    server: "painterjobs-mcp",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    hubspot_configured: !!HUBSPOT_TOKEN
  });
});

// Root endpoint with API documentation
app.get("/", (req, res) => {
  res.json({
    message: "🎨 Painting Concierge MCP Server",
    version: "1.0.0",
    tools: tools.map(t => ({ name: t.name, description: t.description })),
    resources: resources.map(r => ({ uri: r.uri, name: r.name })),
    valid_services: VALID_SERVICES,
    endpoints: {
      "GET /": "This documentation",
      "GET /health": "Health check",
      "POST /mcp": "MCP protocol endpoint"
    },
    examples: {
      get_top_painters: {
        method: "POST",
        url: "/mcp",
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "get_top_painters",
            arguments: {
              postcode: "2093",
              service: "Interior House Painting"
            }
          }
        }
      },
      create_job: {
        method: "POST",
        url: "/mcp",
        body: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "create_job",
            arguments: {
              job_description: "Full interior repaint of 3-bedroom apartment including walls, ceilings, and trims",
              postcode: "2093",
              subtype: "Interior House Painting",
              customer_type: "homeowner",
              customer_intent: "Ready to hire",
              timing: "Within the next 2 weeks",
              job_size: "medium",
              estimate_range: "$3000-$5000",
              preferred_contact_method: "Mobile phone call",
              insights_or_red_flags: "Customer preparing property for sale - timeline is important",
              budget: "$4500"
            }
          }
        }
      }
    }
  });
});

// Start HTTP server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MCP Server running on port ${PORT}`);
  console.log(`📍 Server URL: ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : `http://localhost:${PORT}`}`);
  console.log(`📍 Check health: ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : `http://localhost:${PORT}`}/health`);
});
