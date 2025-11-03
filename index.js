#!/usr/bin/env node

/**
 * Service Seeking MCP Server - HTTP Version
 * Express server with MCP protocol support via HTTP/JSON-RPC
 * Supports STDIO transport for local testing with MCP Inspector
 */

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load all category services from generated file
const categoryServicesPath = join(__dirname, "category_services.json");
const CATEGORY_SERVICES = JSON.parse(readFileSync(categoryServicesPath, "utf-8"));

const app = express();
app.use(cors());

// Add request logging for debugging
app.use((req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// JSON parsing with error handling
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    // Store raw body for debugging
    req.rawBody = buf.toString(encoding || 'utf8');
  }
}));

// JSON parsing error handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('JSON Parse Error:', err.message);
    console.error('Raw body:', req.rawBody?.substring(0, 500));
    return res.status(400).json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: "Parse error",
        data: err.message
      }
    });
  }
  next(err);
});

// Configuration
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN || "";
const MCP_API_KEY = process.env.MCP_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const IMGBB_API_KEY = process.env.IMGBB_API_KEY || "";
const POSTCODE_URL = "https://raw.githubusercontent.com/cleopatterson/service_seeking/main/postcode_to_region_area.json";

// OAuth Configuration
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "painterjobs-mcp-client";
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "";
const OAUTH_TOKEN_EXPIRY = 3600; // 1 hour in seconds

// In-memory token storage (use Redis/database in production)
const accessTokens = new Map();

// Legacy constant for backward compatibility (painting services)
const VALID_SERVICES = CATEGORY_SERVICES.painter || [];

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
  },
  {
    name: "get_knowledge_base",
    description: "Get the comprehensive scoping and qualification guide for a specific service category (e.g., painting, plumbing, electrical). Contains category definitions, sizing rules, and essential questions. Use this to understand how to qualify jobs in that category.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Service category (e.g., 'painting', 'plumbing', 'electrical')",
          default: "painting"
        }
      },
      required: []
    }
  },
  {
    name: "get_pricing_guide",
    description: "Get comprehensive pricing information for a specific service category, including real-world examples and detailed guidance on how to analyze jobs and provide intelligent estimates with reasoning. Use this whenever customers ask about pricing.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Service category (e.g., 'painting', 'plumbing', 'electrical')",
          default: "painting"
        }
      },
      required: []
    }
  },
  {
    name: "get_user",
    description: "Search for a user/contact in HubSpot by email address. Returns the contact ID if found, or an error message if not found.",
    inputSchema: {
      type: "object",
      properties: {
        email: {
          type: "string",
          description: "Email address of the user to search for",
          format: "email"
        },
        hubspot_token: {
          type: "string",
          description: "HubSpot API token (optional - uses HUBSPOT_TOKEN env var if not provided)"
        }
      },
      required: ["email"]
    }
  },
  {
    name: "analyze_image",
    description: "Analyze an image using OpenAI GPT-4 Vision API. Accepts base64 image data from file upload, returns AI description and optionally creates a permanent URL for the image that can be attached to HubSpot deals.",
    inputSchema: {
      type: "object",
      properties: {
        image_data: {
          type: "string",
          description: "Base64 encoded image data (data URL format: 'data:image/jpeg;base64,...' or just the base64 string)"
        },
        question: {
          type: "string",
          description: "Question to ask about the image (optional - defaults to 'What is in this image? Describe it in detail.')"
        },
        create_permanent_url: {
          type: "boolean",
          description: "Whether to upload the image to a permanent URL (optional - defaults to false)"
        },
        openai_api_key: {
          type: "string",
          description: "OpenAI API key (optional - uses OPENAI_API_KEY env var if not provided)"
        },
        imgbb_api_key: {
          type: "string",
          description: "ImgBB API key for permanent URL upload (optional - uses IMGBB_API_KEY env var if not provided)"
        }
      },
      required: ["image_data"]
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
  },
  {
    uri: "painterjobs://pricing-reference",
    name: "Painting Pricing Reference Guide",
    description: "Real-world pricing examples for painting jobs across different categories, scales, and complexities",
    mimeType: "text/plain"
  },
  {
    uri: "painterjobs://pricing-analysis-guide",
    name: "Pricing Analysis Guide",
    description: "Detailed guidance on how to analyze job requirements and provide intelligent price estimates with proper reasoning",
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
    const errorData = {
      region: null,
      area: null,
      total_painters: "0",
      top_painters_json: "[]",
      top_painter_1_details: "",
      top_painter_2_details: "",
      top_painter_3_details: "",
      top_painters: [],
      error: "Missing required parameters"
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorData, null, 2)
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
      const errorData = {
        region: null,
        area: null,
        total_painters: "0",
        top_painters_json: "[]",
        top_painter_1_details: "",
        top_painter_2_details: "",
        top_painter_3_details: "",
        top_painters: [],
        error: "Invalid postcode"
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(errorData, null, 2)
          }
        ],
        data: errorData
      };
    }

    region = match.region;
    area = match.area;
  } catch (err) {
    const errorData = {
      region: null,
      area: null,
      total_painters: "0",
      top_painters_json: "[]",
      top_painter_1_details: "",
      top_painter_2_details: "",
      top_painter_3_details: "",
      top_painters: [],
      error: err.message
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorData, null, 2)
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
    const errorData = {
      region,
      area,
      total_painters: "0",
      top_painters_json: "[]",
      top_painter_1_details: "",
      top_painter_2_details: "",
      top_painter_3_details: "",
      top_painters: [],
      error: `HubSpot error: ${err.message}`
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorData, null, 2)
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

  // Return outputs - both text for AI and structured data for Voiceflow
  const responseData = {
    region,
    area,
    total_painters: String(total_painters),
    top_painters_json: JSON.stringify(top3),
    top_painter_1_details: d1,
    top_painter_2_details: d2,
    top_painter_3_details: d3,
    top_painters: top3  // Include parsed array for direct access
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(responseData, null, 2)
      }
    ]
  };
}

// Create Job function - creates a Deal in HubSpot
async function createJob(args) {
  const hubspot_token = args.hubspot_token || HUBSPOT_TOKEN;

  if (!hubspot_token) {
    const errorData = {
      success: false,
      error: "Missing HubSpot API token"
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorData, null, 2)
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
      const errorData = {
        success: false,
        error: `Invalid postcode: ${args.postcode}`
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(errorData, null, 2)
          }
        ],
        data: errorData
      };
    }

    region = match.region;
    area = match.area;
  } catch (err) {
    const errorData = {
      success: false,
      error: `Postcode lookup failed: ${err.message}`
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorData, null, 2)
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

    const responseData = {
      success: true,
      deal_id: dealData.id,
      dealname: dealname,
      region: region,
      area: area,
      job_size: args.job_size,
      job_size_weight: job_size_weight,
      message: "Job created successfully in HubSpot"
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(responseData, null, 2)
        }
      ]
    };
  } catch (err) {
    const errorData = {
      success: false,
      error: `Failed to create deal: ${err.message}`
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorData, null, 2)
        }
      ]
    };
  }
}

// Get Knowledge Base tool - returns scoping guide for a category
async function getKnowledgeBase(args = {}) {
  const category = args.category || "painting";

  try {
    const knowledgeBasePath = join(__dirname, "resources", category, "knowledge_base.txt");
    const knowledgeBaseContent = readFileSync(knowledgeBasePath, "utf-8");

    return {
      content: [
        {
          type: "text",
          text: knowledgeBaseContent
        }
      ]
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Failed to load knowledge base for category '${category}' - ${err.message}\n\nMake sure resources/${category}/knowledge_base.txt exists.`
        }
      ]
    };
  }
}

// Get Pricing Guide tool - combines reference examples and analysis guidance for a category
async function getPricingGuide(args = {}) {
  const category = args.category || "painting";

  try {
    const pricingReferencePath = join(__dirname, "resources", category, "pricing_reference.txt");
    const pricingAnalysisPath = join(__dirname, "resources", category, "pricing_analysis_guide.txt");

    const pricingReferenceContent = readFileSync(pricingReferencePath, "utf-8");
    const pricingAnalysisContent = readFileSync(pricingAnalysisPath, "utf-8");

    const combinedContent = `${pricingAnalysisContent}

---

${pricingReferenceContent}`;

    return {
      content: [
        {
          type: "text",
          text: combinedContent
        }
      ]
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Failed to load pricing guide for category '${category}' - ${err.message}\n\nMake sure resources/${category}/pricing_reference.txt and pricing_analysis_guide.txt exist.`
        }
      ]
    };
  }
}

// Get User tool - searches HubSpot for a contact by email address
async function getUser(args) {
  const email = args.email;
  const hubspot_token = args.hubspot_token || HUBSPOT_TOKEN;

  // Validation
  if (!email || !hubspot_token) {
    const errorData = {
      success: false,
      user_found: false,
      error: "Missing required parameters (email or hubspot_token)"
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorData, null, 2)
        }
      ]
    };
  }

  // Search HubSpot for contact by email
  try {
    const searchBody = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "email",
              operator: "EQ",
              value: email
            }
          ]
        }
      ],
      properties: ["hs_object_id", "email", "firstname", "lastname"],
      limit: 1
    };

    const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${hubspot_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(searchBody)
    });

    if (!response.ok) {
      throw new Error(`HubSpot search failed: ${response.status}`);
    }

    const data = await response.json();

    console.log(`[get_user] Search results for ${email}:`, JSON.stringify(data, null, 2));

    // Check if contact was found
    if (data.results && data.results.length > 0) {
      const contact = data.results[0];
      const contactId = contact.id || contact.properties?.hs_object_id;

      const responseData = {
        success: true,
        user_found: true,
        contact_id: contactId,
        email: contact.properties?.email || email,
        firstname: contact.properties?.firstname || null,
        lastname: contact.properties?.lastname || null
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(responseData, null, 2)
          }
        ]
      };
    } else {
      // No user found
      const responseData = {
        success: true,
        user_found: false,
        message: "No user exists with this email address",
        email: email
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(responseData, null, 2)
          }
        ]
      };
    }
  } catch (err) {
    const errorData = {
      success: false,
      user_found: false,
      error: `HubSpot error: ${err.message}`,
      email: email
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorData, null, 2)
        }
      ]
    };
  }
}

// Analyze Image tool - uses OpenAI Vision API and optionally creates permanent URL
async function analyzeImage(args) {
  const image_data = args.image_data;
  const question = args.question || "What is in this image? Describe it in detail.";
  const create_permanent_url = args.create_permanent_url || false;
  const openai_api_key = args.openai_api_key || OPENAI_API_KEY;
  const imgbb_api_key = args.imgbb_api_key || IMGBB_API_KEY;

  // Validation
  if (!image_data) {
    const errorData = {
      success: false,
      error: "Missing required parameter: image_data"
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorData, null, 2)
        }
      ]
    };
  }

  if (!openai_api_key) {
    const errorData = {
      success: false,
      error: "Missing OpenAI API key (provide openai_api_key parameter or set OPENAI_API_KEY env variable)"
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorData, null, 2)
        }
      ]
    };
  }

  try {
    // Ensure image_data is in proper data URL format
    let imageUrl = image_data;
    if (!image_data.startsWith('data:image')) {
      // If just base64 string, add the data URL prefix (assume JPEG)
      imageUrl = `data:image/jpeg;base64,${image_data}`;
    }

    // Step 1: Call OpenAI Vision API
    console.log('[analyze_image] Calling OpenAI Vision API...');
    const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openai_api_key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: question
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl
                }
              }
            ]
          }
        ],
        max_tokens: 500
      })
    });

    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      throw new Error(`OpenAI Vision API error ${visionResponse.status}: ${errorText}`);
    }

    const visionData = await visionResponse.json();
    const description = visionData.choices[0].message.content;

    console.log('[analyze_image] Vision analysis complete');

    // Step 2: Optionally create permanent URL
    let permanentUrl = null;

    if (create_permanent_url) {
      console.log('[analyze_image] Creating permanent URL...');

      if (!imgbb_api_key) {
        console.warn('[analyze_image] No ImgBB API key provided, skipping permanent URL creation');
      } else {
        try {
          // Extract base64 data (remove data URL prefix)
          const base64Data = image_data.includes('base64,')
            ? image_data.split('base64,')[1]
            : image_data;

          // Upload to ImgBB
          const formData = new URLSearchParams();
          formData.append('image', base64Data);

          const uploadResponse = await fetch(`https://api.imgbb.com/1/upload?key=${imgbb_api_key}`, {
            method: 'POST',
            body: formData
          });

          if (uploadResponse.ok) {
            const uploadData = await uploadResponse.json();
            permanentUrl = uploadData.data.url;
            console.log('[analyze_image] Permanent URL created:', permanentUrl);
          } else {
            console.warn('[analyze_image] Failed to create permanent URL:', uploadResponse.status);
          }
        } catch (uploadErr) {
          console.warn('[analyze_image] Error creating permanent URL:', uploadErr.message);
        }
      }
    }

    // Step 3: Return response
    const responseData = {
      success: true,
      description: description,
      permanent_url: permanentUrl,
      question_asked: question,
      has_permanent_url: !!permanentUrl
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(responseData, null, 2)
        }
      ]
    };

  } catch (err) {
    const errorData = {
      success: false,
      error: `Failed to analyze image: ${err.message}`
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorData, null, 2)
        }
      ]
    };
  }
}

// ============================================================================
// FastMCP Server Setup (for proper MCP protocol support)
// ============================================================================

const mcpServer = new Server(
  {
    name: "painterjobs-mcp",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {},
      resources: {}
    }
  }
);

// Register MCP tool handlers
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_top_painters") {
    return await getTopPainters(args || {});
  } else if (name === "create_job") {
    return await createJob(args || {});
  } else if (name === "get_knowledge_base") {
    return await getKnowledgeBase(args || {});
  } else if (name === "get_pricing_guide") {
    return await getPricingGuide(args || {});
  } else if (name === "get_user") {
    return await getUser(args || {});
  } else if (name === "analyze_image") {
    return await analyzeImage(args || {});
  }

  throw new Error(`Unknown tool: ${name}`);
});

mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: resources
}));

mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === "painterjobs://valid-services") {
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          services: VALID_SERVICES,
          note: "Service parameter must match one of these values EXACTLY"
        }, null, 2)
      }]
    };
  } else if (uri === "painterjobs://painting-knowledge-base") {
    const knowledgeBasePath = join(__dirname, "resources", "painting", "knowledge_base.txt");
    const knowledgeBaseContent = readFileSync(knowledgeBasePath, "utf-8");
    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text: knowledgeBaseContent
      }]
    };
  } else if (uri === "painterjobs://pricing-reference") {
    const pricingReferencePath = join(__dirname, "resources", "painting", "pricing_reference.txt");
    const pricingReferenceContent = readFileSync(pricingReferencePath, "utf-8");
    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text: pricingReferenceContent
      }]
    };
  } else if (uri === "painterjobs://pricing-analysis-guide") {
    const pricingAnalysisPath = join(__dirname, "resources", "painting", "pricing_analysis_guide.txt");
    const pricingAnalysisContent = readFileSync(pricingAnalysisPath, "utf-8");
    return {
      contents: [{
        uri,
        mimeType: "text/plain",
        text: pricingAnalysisContent
      }]
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// Authentication middleware for MCP endpoint
function authenticateMCP(req, res, next) {
  // Allow health check, root endpoint, OAuth endpoints, and well-known paths to be public
  if (req.path === "/health" ||
      req.path === "/" ||
      req.path === "/oauth/token" ||
      req.path.startsWith("/.well-known/")) {
    return next();
  }

  // Check for API key in Authorization header or X-API-Key header
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];

  let providedKey = null;
  let isOAuthToken = false;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Check if it's an OAuth token
    const tokenData = accessTokens.get(providedKey);
    if (tokenData) {
      // Verify token hasn't expired
      if (Date.now() < tokenData.expiresAt) {
        isOAuthToken = true;
        req.oauthToken = tokenData;
      } else {
        // Token expired, remove it
        accessTokens.delete(providedKey);
        return res.status(401).json({
          jsonrpc: "2.0",
          id: req.body?.id || null,
          error: {
            code: -32000,
            message: "Unauthorized - OAuth token expired"
          }
        });
      }
    }
  } else if (apiKeyHeader) {
    providedKey = apiKeyHeader;
  }

  // If OAuth token is valid, allow access
  if (isOAuthToken) {
    return next();
  }

  // Otherwise, check against MCP_API_KEY
  if (!MCP_API_KEY) {
    console.error("[AUTH] MCP_API_KEY not configured in environment");
    return res.status(500).json({
      jsonrpc: "2.0",
      id: req.body?.id || null,
      error: {
        code: -32000,
        message: "Server authentication not configured"
      }
    });
  }

  if (!providedKey || providedKey !== MCP_API_KEY) {
    console.warn("[AUTH] Unauthorized MCP access attempt");
    return res.status(401).json({
      jsonrpc: "2.0",
      id: req.body?.id || null,
      error: {
        code: -32000,
        message: "Unauthorized - Invalid or missing API key"
      }
    });
  }

  // Authentication successful
  next();
}

// MCP Protocol Endpoints with JSONRPC 2.0 support
app.post("/mcp", authenticateMCP, async (req, res) => {
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
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
            resources: {},
            experimental: {}
          },
          serverInfo: {
            name: "painterjobs-mcp",
            version: "1.0.0"
          },
          authentication: {
            type: "oauth2",
            oauth2: {
              authorizationUrl: null,
              tokenUrl: `${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : `http://localhost:${process.env.PORT || 3000}`}/oauth/token`,
              clientId: OAUTH_CLIENT_ID,
              grantType: "client_credentials",
              scopes: []
            }
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
            const knowledgeBasePath = join(__dirname, "resources", "painting", "knowledge_base.txt");
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
        } else if (uri === "painterjobs://pricing-reference") {
          try {
            const pricingReferencePath = join(__dirname, "resources", "painting", "pricing_reference.txt");
            const pricingReferenceContent = readFileSync(pricingReferencePath, "utf-8");
            return res.json(respond({
              contents: [
                {
                  uri,
                  mimeType: "text/plain",
                  text: pricingReferenceContent
                }
              ]
            }));
          } catch (err) {
            return res.json(respond(null, {
              code: -32603,
              message: `Failed to read pricing reference: ${err.message}`
            }));
          }
        } else if (uri === "painterjobs://pricing-analysis-guide") {
          try {
            const pricingAnalysisPath = join(__dirname, "resources", "painting", "pricing_analysis_guide.txt");
            const pricingAnalysisContent = readFileSync(pricingAnalysisPath, "utf-8");
            return res.json(respond({
              contents: [
                {
                  uri,
                  mimeType: "text/plain",
                  text: pricingAnalysisContent
                }
              ]
            }));
          } catch (err) {
            return res.json(respond(null, {
              code: -32603,
              message: `Failed to read pricing analysis guide: ${err.message}`
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
        } else if (name === "get_knowledge_base") {
          const result = await getKnowledgeBase(args || {});
          return res.json(respond(result));
        } else if (name === "get_pricing_guide") {
          const result = await getPricingGuide(args || {});
          return res.json(respond(result));
        } else if (name === "get_user") {
          const result = await getUser(args || {});
          return res.json(respond(result));
        } else if (name === "analyze_image") {
          const result = await analyzeImage(args || {});
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

// OAuth 2.0 Discovery Endpoints (for ChatGPT OAuth discovery)
// Handle both with and without /mcp suffix (ChatGPT requests both)
app.get("/.well-known/oauth-authorization-server/:path?", (req, res) => {
  // Use OAUTH_BASE_URL from env, or build from request host
  const baseUrl = process.env.OAUTH_BASE_URL || `https://${req.get('host')}`;

  res.json({
    issuer: baseUrl,
    token_endpoint: `${baseUrl}/oauth/token`,
    grant_types_supported: ["client_credentials"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
    response_types_supported: [],
    scopes_supported: []
  });
});

// OAuth 2.0 Protected Resource Metadata (RFC 8707)
// Handle both with and without /mcp suffix (ChatGPT requests both)
app.get("/.well-known/oauth-protected-resource/:path?", (req, res) => {
  const baseUrl = process.env.OAUTH_BASE_URL || `https://${req.get('host')}`;

  res.json({
    resource: `${baseUrl}/mcp`,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ["header"],
    resource_signing_alg_values_supported: [],
    scopes_supported: []
  });
});

// OAuth 2.0 Token Endpoint (Client Credentials Flow)
app.post("/oauth/token", express.urlencoded({ extended: true }), (req, res) => {
  const { grant_type, client_id, client_secret } = req.body;

  console.log(`[OAUTH] Token request - grant_type: ${grant_type}, client_id: ${client_id}`);

  // Validate grant type
  if (grant_type !== "client_credentials") {
    return res.status(400).json({
      error: "unsupported_grant_type",
      error_description: "Only client_credentials grant type is supported"
    });
  }

  // Validate client credentials
  if (!OAUTH_CLIENT_SECRET) {
    console.error("[OAUTH] OAUTH_CLIENT_SECRET not configured");
    return res.status(500).json({
      error: "server_error",
      error_description: "OAuth not configured on server"
    });
  }

  if (client_id !== OAUTH_CLIENT_ID || client_secret !== OAUTH_CLIENT_SECRET) {
    console.warn("[OAUTH] Invalid client credentials");
    return res.status(401).json({
      error: "invalid_client",
      error_description: "Invalid client_id or client_secret"
    });
  }

  // Generate access token
  const accessToken = `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  const expiresAt = Date.now() + (OAUTH_TOKEN_EXPIRY * 1000);

  // Store token
  accessTokens.set(accessToken, {
    clientId: client_id,
    createdAt: Date.now(),
    expiresAt: expiresAt
  });

  console.log(`[OAUTH] Token generated successfully, expires in ${OAUTH_TOKEN_EXPIRY}s`);

  // Return token response
  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: OAUTH_TOKEN_EXPIRY
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    server: "painterjobs-mcp",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    hubspot_configured: !!HUBSPOT_TOKEN,
    authentication_required: true,
    api_key_configured: !!MCP_API_KEY
  });
});

// Root endpoint with API documentation
app.get("/", (req, res) => {
  res.json({
    message: "🎨 Painting Concierge MCP Server",
    version: "1.0.0",
    authentication: {
      required: true,
      method: "Bearer token or X-API-Key header",
      example_header_1: "Authorization: Bearer YOUR_API_KEY",
      example_header_2: "X-API-Key: YOUR_API_KEY"
    },
    tools: tools.map(t => ({ name: t.name, description: t.description })),
    resources: resources.map(r => ({ uri: r.uri, name: r.name })),
    valid_services: VALID_SERVICES,
    endpoints: {
      "GET /": "This documentation",
      "GET /health": "Health check (public)",
      "POST /mcp": "MCP protocol endpoint (requires authentication)"
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
      },
      get_knowledge_base: {
        method: "POST",
        url: "/mcp",
        body: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "get_knowledge_base",
            arguments: {
              category: "painting"
            }
          }
        }
      },
      get_pricing_guide: {
        method: "POST",
        url: "/mcp",
        body: {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "get_pricing_guide",
            arguments: {
              category: "painting"
            }
          }
        }
      }
    }
  });
});

// Detect if we're running in STDIO mode (for MCP Inspector)
// Only use STDIO mode if explicitly requested or when run by Inspector
// Never use STDIO on Replit (always use HTTP server there)
const isReplit = !!(process.env.REPL_SLUG || process.env.REPLIT_DB_URL);
const isStdioMode = !isReplit && process.env.MCP_TRANSPORT === 'stdio';

if (isStdioMode) {
  // STDIO mode - for MCP Inspector and Claude Desktop
  console.error('🔌 Starting MCP server in STDIO mode...');

  const transport = new StdioServerTransport();
  mcpServer.connect(transport).then(() => {
    console.error('✅ MCP Server ready (STDIO mode)');
  }).catch((error) => {
    console.error('❌ Failed to start STDIO server:', error);
    process.exit(1);
  });
} else {
  // HTTP mode - for Voiceflow and web-based integrations
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ MCP Server running on port ${PORT}`);
    console.log(`📍 Server URL: ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : `http://localhost:${PORT}`}`);
    console.log(`📍 Check health: ${process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co` : `http://localhost:${PORT}`}/health`);
  });
}
