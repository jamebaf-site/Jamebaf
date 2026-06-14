// ============================================================
//  jamebaf-supabase.js  —  drop-in browser client
//  Version: v1.7
//  Public site + email/password admin accounts. No SMS, no
//  visitor accounts, no bookmarks. Products support MULTIPLE
//  photos each (stored in the products.images column).
//
//  Load in index.html before your own script:
//  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//  <script src="jamebaf-supabase.js"></script>
// ============================================================

const SUPABASE_URL = "https://nrpphqnqbmncnwnndyqf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_z1irQsxDp8HPVHTtRr8reQ_NbunzpUn";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PHOTO_BUCKET = "product-photos";
const PUBLIC_PREFIX = SUPABASE_URL + "/storage/v1/object/public/" + PHOTO_BUCKET + "/";

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
  // Each product is normalised to always have an `images` array.
  async listProducts() {
    const { data } = await sb.from("products")
      .select("*").order("created_at", { ascending: false });
    return (data ?? []).map(p => {
      let imgs = Array.isArray(p.images) ? p.images : [];
      if (!imgs.length && p.image_url) imgs = [p.image_url];
      return { ...p, images: imgs };
    });
  },

  // ---- ADMIN ONLY: add a product with one OR many photos ----
  async addProduct({ title, description, files }) {
    const list = files ? Array.from(files) : [];
    const urls = [];
    for (const file of list) {
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error: upErr } = await sb.storage.from(PHOTO_BUCKET).upload(path, file);
      if (upErr) throw upErr;
      urls.push(sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl);
    }
    const { error } = await sb.from("products").insert({
      title,
      description,
      image_url: urls[0] ?? null,   // cover photo (first one)
      images: urls                  // every photo
    });
    if (error) throw error;
  },

  async deleteProduct(id) {
    // best-effort: remove this product's photos from storage first
    try {
      const { data: row } = await sb.from("products")
        .select("images,image_url").eq("id", id).single();
      const urls = (row?.images?.length ? row.images : (row?.image_url ? [row.image_url] : []));
      const paths = urls
        .map(u => (typeof u === "string" && u.startsWith(PUBLIC_PREFIX))
          ? decodeURIComponent(u.slice(PUBLIC_PREFIX.length)) : null)
        .filter(Boolean);
      if (paths.length) await sb.storage.from(PHOTO_BUCKET).remove(paths);
    } catch (e) { /* ignore cleanup errors, still delete the row */ }

    const { error } = await sb.from("products").delete().eq("id", id);
    if (error) throw error;
  },
};

window.JB = JB;
