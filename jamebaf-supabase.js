// ============================================================
//  jamebaf-supabase.js  —  drop-in browser client
//  Public site + email/password admin accounts. No SMS, no
//  visitor accounts, no bookmarks.
//
//  Load in index.html before your own script:
//  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//  <script src="jamebaf-supabase.js"></script>
// ============================================================

const SUPABASE_URL = "https://nrpphqnqbmncnwnndyqf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_z1irQsxDp8HPVHTtRr8reQ_NbunzpUn";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const JB = {
  // ---- ADMIN AUTH (email + password) ----
  async login(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  },

  async logout() { await sb.auth.signOut(); },

  async currentUser() {
    const { data } = await sb.auth.getUser();
    return data.user ?? null;
  },

  // True only for accounts you've flagged is_admin = true in the dashboard.
  async isAdmin() {
    const user = await this.currentUser();
    if (!user) return false;
    const { data } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
    return !!data?.is_admin;
  },

  // ---- PRODUCTS (anyone can read, even logged out) ----
  async listProducts() {
    const { data } = await sb.from("products")
      .select("*").order("created_at", { ascending: false });
    return data ?? [];
  },

  // ---- ADMIN ONLY: manage products ----
  async addProduct({ title, description, file }) {
    let image_url = null;
    if (file) {
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await sb.storage.from("product-photos").upload(path, file);
      if (upErr) throw upErr;
      image_url = sb.storage.from("product-photos").getPublicUrl(path).data.publicUrl;
    }
    const { error } = await sb.from("products").insert({ title, description, image_url });
    if (error) throw error;
  },

  async deleteProduct(id) {
    const { error } = await sb.from("products").delete().eq("id", id);
    if (error) throw error;
  },
};

window.JB = JB;
