export default async function handler(req, res) {
  try {
    const response = await fetch("https://movientum-ewhhfwahfdh2bfgd.southeastasia-01.azurewebsites.net/api/health");
    const data = await response.json();
    res.status(200).json({ ok: true, backendStatus: data });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
}
