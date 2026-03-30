export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return res.status(500).json({
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    });
  }

  const {
    name = "",
    email = "",
    phone = "",
    url = "",
    businessType = "",
    goal = "",
    extraContext = "",
    critiqueScore = null,
    followUpMessage = ""
  } = req.body || {};

  if (!url) {
    return res.status(400).json({ error: "Website URL is required." });
  }

  try {
    const payload = {
      name,
      email,
      phone,
      website: url,
      business_type: businessType,
      goal,
      extra_context: extraContext,
      status: "new",
      critique_score: critiqueScore,
      follow_up_message: followUpMessage
    };

    const response = await fetch(`${supabaseUrl}/rest/v1/leads`, {
      method: "POST",
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(payload)
    });

    const json = await response.json();

    if (!response.ok) {
      throw new Error(json?.message || json?.error || "Supabase insert failed.");
    }

    const row = Array.isArray(json) ? json[0] : null;

    return res.status(200).json({
      ok: true,
      leadId: row?.id || null,
      createdAt: row?.created_at || null,
      row
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Lead logging failed."
    });
  }
}
