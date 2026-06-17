// ============================================================
//  jamebaf-supabase.js  —  drop-in browser client
//  Version: v2.0
//  Public catalog + email/password admin. No SMS, no visitor
//  accounts. Products support MULTIPLE photos (products.images).
//  Photos are uploaded with a 1-year cache header to minimise
//  repeated egress (bandwidth) on the free plan.
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
const ONE_YEAR = "31536000"; // cache-control seconds → fewer repeat downloads

function urlToPath(u){
  return (typeof u === "string" && u.startsWith(PUBLIC_PREFIX))
    ? decodeURIComponent(u.slice(PUBLIC_PREFIX.length)) : null;
}
function missingImagesColumn(error){
  const m = (error && error.message || "").toLowerCase();
  return m.includes("images") && (m.includes("column") || m.includes("schema"));
}

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
  async isAdmin() {
    const user = await this.currentUser();
    if (!user) return false;
    const { data } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
    return !!data?.is_admin;
  },

  // ---- PRODUCTS (anyone can read) ----
  async listProducts() {
    const { data } = await sb.from("products")
      .select("*").order("created_at", { ascending: false });
    return (data ?? []).map(p => {
      let imgs = Array.isArray(p.images) ? p.images : [];
      if (!imgs.length && p.image_url) imgs = [p.image_url];
      return { ...p, images: imgs };
    });
  },

  // ---- STORAGE: total bytes used (for the cap + usage bar) ----
  async storageUsage() {
    let bytes = 0, count = 0, offset = 0;
    const limit = 100;
    for (;;) {
      const { data, error } = await sb.storage.from(PHOTO_BUCKET)
        .list("", { limit, offset, sortBy: { column: "name", order: "asc" } });
      if (error || !data || !data.length) break;
      for (const o of data) { bytes += (o.metadata && o.metadata.size) ? o.metadata.size : 0; count++; }
      if (data.length < limit) break;
      offset += limit;
    }
    return { bytes, count };
  },

  // ---- ADMIN: upload helper (returns public URLs, in order) ----
  async uploadPhotos(files) {
    const urls = [];
    for (const file of Array.from(files || [])) {
      const ext = ((file.name && file.name.split(".").pop()) || "jpg")
        .replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpg";
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await sb.storage.from(PHOTO_BUCKET)
        .upload(path, file, { contentType: file.type || "image/jpeg", cacheControl: ONE_YEAR });
      if (error) throw error;
      urls.push(sb.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl);
    }
    return urls;
  },

  // ---- ADMIN: create with already-uploaded image URLs ----
  async createProduct({ title, description, images }) {
    const imgs = images || [];
    const { error } = await sb.from("products").insert({
      title, description, image_url: imgs[0] ?? null, images: imgs
    });
    if (error) {
      if (missingImagesColumn(error)) throw new Error("ستون «images» در جدول products وجود ندارد — دستور SQL مرحله نصب را در Supabase اجرا کنید.");
      throw error;
    }
  },

  // ---- ADMIN: edit a product; removedUrls get cleaned from storage ----
  async updateProduct(id, { title, description, images, removedUrls }) {
    const imgs = images || [];
    const { error } = await sb.from("products").update({
      title, description, image_url: imgs[0] ?? null, images: imgs
    }).eq("id", id);
    if (error) {
      if (missingImagesColumn(error)) throw new Error("ستون «images» در جدول products وجود ندارد — دستور SQL مرحله نصب را در Supabase اجرا کنید.");
      throw error;
    }
    const paths = (removedUrls || []).map(urlToPath).filter(Boolean);
    if (paths.length) { try { await sb.storage.from(PHOTO_BUCKET).remove(paths); } catch (e) {} }
  },

  async deleteProduct(id) {
    try {
      const { data: row } = await sb.from("products").select("images,image_url").eq("id", id).single();
      const urls = (row?.images?.length ? row.images : (row?.image_url ? [row.image_url] : []));
      const paths = urls.map(urlToPath).filter(Boolean);
      if (paths.length) await sb.storage.from(PHOTO_BUCKET).remove(paths);
    } catch (e) { /* still delete the row */ }
    const { error } = await sb.from("products").delete().eq("id", id);
    if (error) throw error;
  },
  // ---- SITE CONTENT (anyone can read; admin can write) ----
  // Returns a { key: value } map of all editable regions.
  async getContent() {
    const { data, error } = await sb.from("site_content").select("key,value");
    if (error) throw error;
    const map = {};
    for (const row of (data ?? [])) map[row.key] = row.value;
    return map;
  },

  // Upsert one region. value may be a string or a JSON-serialisable object.
  async saveContent(key, value) {
    const { error } = await sb.from("site_content")
      .upsert({ key, value }, { onConflict: "key" });
    if (error) {
      const m = (error.message || "").toLowerCase();
      if (m.includes("site_content") && (m.includes("does not exist") || m.includes("schema") || m.includes("relation"))) {
        throw new Error("جدول «site_content» وجود ندارد — دستور SQL مرحله نصب را در Supabase اجرا کنید.");
      }
      throw error;
    }
  },

  // Upsert several regions at once: pass an array of { key, value }.
  async saveContentBatch(rows) {
    const payload = (rows || []).filter(r => r && r.key);
    if (!payload.length) return;
    const { error } = await sb.from("site_content")
      .upsert(payload, { onConflict: "key" });
    if (error) throw error;
  },
};

window.JB = JB;
