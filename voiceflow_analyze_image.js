export default async function main(args) {
  // Expected args.inputVars:
  // - image_data (string, base64) OR image_url (string, URL) - at least one required
  // - question (string, optional)
  // - create_permanent_url (boolean, optional - defaults to false)
  // - openai_api_key (string, required)

  const image_data = args.inputVars.image_data;
  const image_url = args.inputVars.image_url;
  const question = args.inputVars.question || "In 2-3 concise sentences, describe: 1) What type of surface (e.g., fence, walls, ceiling) and material (wood, brick, concrete, etc.), 2) Estimated size/scope (e.g., fence length in meters, room dimensions, number of rooms), 3) Current condition (damage, peeling, stains, weathering).";
  const create_permanent_url = args.inputVars.create_permanent_url || false;
  const openai_api_key = args.inputVars.openai_api_key;

  // Cloudinary configuration
  const CLOUDINARY_CLOUD_NAME = "dbwtidda3";
  const CLOUDINARY_API_KEY = "543844426683347";
  const cloudinary_api_secret = args.inputVars.cloudinary_api_secret || "";

  // ---------- 1) Validation ----------
  if (!image_data && !image_url) {
    return {
      outputVars: {
        success: false,
        description: "",
        permanent_url: "",
        has_permanent_url: false,
        question_asked: question
      },
      trace: [{ type: "text", payload: { message: "❌ Missing required parameter: either image_data (base64) or image_url must be provided" } }]
    };
  }

  if (!openai_api_key) {
    return {
      outputVars: {
        success: false,
        description: "",
        permanent_url: "",
        has_permanent_url: false,
        question_asked: question
      },
      trace: [{ type: "text", payload: { message: "❌ Missing OpenAI API key" } }]
    };
  }

  try {
    // ---------- 2) Prepare image URL for OpenAI ----------
    let imageUrl;

    if (image_url) {
      // If URL provided, use it directly
      imageUrl = image_url;
    } else {
      // If base64 provided, ensure it's in proper data URL format
      if (!image_data.startsWith('data:image')) {
        // If just base64 string, add the data URL prefix (assume JPEG)
        imageUrl = `data:image/jpeg;base64,${image_data}`;
      } else {
        imageUrl = image_data;
      }
    }

    // ---------- 3) Start both OpenAI Vision and Cloudinary upload in parallel ----------
    const promises = [];

    // Start OpenAI Vision API call
    const visionPromise = fetch('https://api.openai.com/v1/chat/completions', {
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
    promises.push(visionPromise);

    // Start Cloudinary upload in parallel (if needed)
    let uploadPromise = null;
    if (create_permanent_url && image_data && cloudinary_api_secret) {
      try {
        // Extract base64 data (remove data URL prefix)
        const base64Data = image_data.includes('base64,')
          ? image_data.split('base64,')[1]
          : image_data;

        // Prepare data URL for Cloudinary
        const dataUrl = image_data.startsWith('data:')
          ? image_data
          : `data:image/jpeg;base64,${base64Data}`;

        // Generate timestamp and signature for Cloudinary
        const timestamp = Math.round(Date.now() / 1000);

        // Create signature using Web Crypto API
        const paramsToSign = `timestamp=${timestamp}${cloudinary_api_secret}`;
        const encoder = new TextEncoder();
        const data = encoder.encode(paramsToSign);
        const hashBuffer = await crypto.subtle.digest('SHA-1', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const signature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Upload to Cloudinary
        const formData = new URLSearchParams();
        formData.append('file', dataUrl);
        formData.append('api_key', CLOUDINARY_API_KEY);
        formData.append('timestamp', timestamp.toString());
        formData.append('signature', signature);

        uploadPromise = fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
          method: 'POST',
          body: formData
        });
        promises.push(uploadPromise);
      } catch (uploadErr) {
        console.log('[analyze_image] Error preparing image upload:', uploadErr.message);
      }
    }

    // ---------- 4) Wait for both operations to complete ----------
    const results = await Promise.all(promises);
    const visionResponse = results[0];
    const uploadResponse = results[1] || null;

    // ---------- 5) Process OpenAI Vision response ----------
    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      throw new Error(`OpenAI Vision API error ${visionResponse.status}: ${errorText}`);
    }

    const visionData = await visionResponse.json();
    const description = visionData.choices[0].message.content;

    // ---------- 6) Process Cloudinary upload response ----------
    let permanentUrl = "";
    if (uploadResponse) {
      try {
        if (uploadResponse.ok) {
          const uploadData = await uploadResponse.json();
          permanentUrl = uploadData.secure_url || "";
        }
      } catch (uploadErr) {
        console.log('[analyze_image] Error processing upload response:', uploadErr.message);
      }
    }

    // ---------- 7) Return response ----------
    return {
      outputVars: {
        success: true,
        description: description,
        permanent_url: permanentUrl,
        has_permanent_url: !!permanentUrl,
        question_asked: question
      },
      trace: []
    };

  } catch (err) {
    return {
      outputVars: {
        success: false,
        description: "",
        permanent_url: "",
        has_permanent_url: false,
        question_asked: question
      },
      trace: [{ type: "text", payload: { message: `🚨 Failed to analyze image: ${err.message}` } }]
    };
  }
}
