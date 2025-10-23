#!/bin/bash

# Local Testing Script for MCP Server
# Usage: ./test-local.sh

BASE_URL="http://localhost:3000"

echo "🧪 Testing MCP Server Locally"
echo "================================"
echo ""

# Test 1: Health Check
echo "1️⃣  Testing Health Endpoint..."
curl -s "$BASE_URL/health" | jq '.'
echo ""
echo ""

# Test 2: Root Documentation
echo "2️⃣  Testing Root Documentation..."
curl -s "$BASE_URL/" | jq '.tools, .resources'
echo ""
echo ""

# Test 3: MCP Initialize
echo "3️⃣  Testing MCP Initialize..."
curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
  }' | jq '.'
echo ""
echo ""

# Test 4: List Tools
echo "4️⃣  Testing MCP Tools List..."
curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }' | jq '.result.tools[] | {name: .name, description: .description}'
echo ""
echo ""

# Test 5: List Resources
echo "5️⃣  Testing MCP Resources List..."
curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "resources/list",
    "params": {}
  }' | jq '.result.resources[] | {uri: .uri, name: .name}'
echo ""
echo ""

# Test 6: Read Painting Knowledge Base
echo "6️⃣  Testing Painting Knowledge Base Resource..."
curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "resources/read",
    "params": {
      "uri": "painterjobs://painting-knowledge-base"
    }
  }' | jq '.result.contents[0] | {uri: .uri, mimeType: .mimeType, text_preview: (.text | split("\n") | .[0:5] | join("\n"))}'
echo ""
echo ""

# Test 7: Get Top Painters (will fail without valid HubSpot token, but tests the endpoint)
echo "7️⃣  Testing get_top_painters tool..."
echo "   (Note: This may fail if HUBSPOT_TOKEN is not set in .env)"
curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "get_top_painters",
      "arguments": {
        "postcode": "2093",
        "service": "Interior House Painting"
      }
    }
  }' | jq '.result // .error'
echo ""
echo ""

# Test 8: Create Job (will fail without valid HubSpot token, but tests the endpoint)
echo "8️⃣  Testing create_job tool..."
echo "   (Note: This may fail if HUBSPOT_TOKEN is not set in .env)"
curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 6,
    "method": "tools/call",
    "params": {
      "name": "create_job",
      "arguments": {
        "job_description": "Full interior repaint of 3-bedroom house including walls, ceilings, and trims",
        "postcode": "2093",
        "subtype": "Interior House Painting",
        "customer_type": "homeowner",
        "customer_intent": "Ready to hire",
        "timing": "Within the next 2 weeks",
        "job_size": "large",
        "estimate_range": "$4000-$6000",
        "preferred_contact_method": "Mobile phone call",
        "insights_or_red_flags": "Customer preparing property for sale",
        "budget": "$5000"
      }
    }
  }' | jq '.result.content[0].text | fromjson'
echo ""
echo ""

echo "✅ Testing Complete!"
echo ""
echo "💡 Tips:"
echo "   - Make sure your .env file has HUBSPOT_TOKEN set for full testing"
echo "   - Tools 7 & 8 require a valid HubSpot token to succeed"
echo "   - Check the server console for detailed logs"
