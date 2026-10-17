// One interface over OneDrive and Google Drive, so "list a folder", "save a
// file here" and "read a file" do not care which the user has.
//   adapter.provider  'onedrive' | 'googledrive'
//   adapter.rootId    id of the top of the user's storage
//   adapter.list(folderId)                 -> [{id,name,folder,size,modified,mimeType}]
//   adapter.upload(folderId,name,buffer,mime) -> {id,name,webUrl}
//   adapter.download(itemId)               -> {name,mimeType,buffer}
import { getValidMicrosoftToken } from '../onedrive-helper.js';
import { getGoogleToken } from './google-auth.js';
import { driveUploadFile } from '../create-google-drive-folder.js';

const SIMPLE_UPLOAD_LIMIT = 4 * 1024 * 1024;

export async function getStorageAdapter(ctx) {
  if (ctx.storage === 'googledrive') return googleDriveAdapter(ctx);
  return oneDriveAdapter(ctx);
}

async function oneDriveAdapter(ctx) {
  const token = await getValidMicrosoftToken(ctx.userEmail);
  if (!token) throw Object.assign(new Error('Your OneDrive/Outlook account is not connected or needs reconnecting.'), { status: 401 });
  const auth = { Authorization: `Bearer ${token}` };
  return {
    provider: 'onedrive',
    rootId: 'root',
    rootLabel: 'OneDrive',
    async list(folderId) {
      const r = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folderId)}/children?$select=id,name,size,webUrl,file,folder,lastModifiedDateTime&$top=200`, { headers: auth });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message || `Could not list folder (${r.status})`);
      return (d.value || []).map(i => ({ id: i.id, name: i.name, folder: !!i.folder, size: i.size || 0, modified: i.lastModifiedDateTime || null, mimeType: i.file?.mimeType || null }));
    },
    async upload(folderId, name, buffer, mime) {
      const base = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}:`;
      if (buffer.length <= SIMPLE_UPLOAD_LIMIT) {
        const r = await fetch(`${base}/content?@microsoft.graph.conflictBehavior=rename`, { method: 'PUT', headers: { ...auth, 'Content-Type': mime }, body: buffer });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error?.message || `OneDrive upload failed (${r.status})`);
        return { id: d.id, name: d.name || name, webUrl: d.webUrl || null };
      }
      const s = await fetch(`${base}/createUploadSession`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename', name } }) });
      const session = await s.json().catch(() => ({}));
      if (!s.ok || !session.uploadUrl) throw new Error(session?.error?.message || `Could not start upload (${s.status})`);
      const chunk = 3276800; // 10 x 320 KiB, as Graph requires
      let offset = 0, item = null;
      while (offset < buffer.length) {
        const end = Math.min(offset + chunk, buffer.length);
        const part = buffer.subarray(offset, end);
        const r = await fetch(session.uploadUrl, { method: 'PUT', headers: { 'Content-Length': String(part.length), 'Content-Range': `bytes ${offset}-${end - 1}/${buffer.length}` }, body: part });
        if (r.status === 200 || r.status === 201) item = await r.json().catch(() => ({}));
        else if (r.status !== 202) throw new Error(`Upload chunk failed (${r.status})`);
        offset = end;
      }
      return { id: item?.id, name: item?.name || name, webUrl: item?.webUrl || null };
    },
    async download(itemId) {
      const m = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}`, { headers: auth });
      if (!m.ok) throw new Error(`Could not read file details (${m.status})`);
      const meta = await m.json();
      const c = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}/content`, { headers: auth });
      if (!c.ok) throw new Error(`Could not read the file (${c.status})`);
      return { name: meta.name || 'attachment', mimeType: meta.file?.mimeType || 'application/octet-stream', buffer: Buffer.from(await c.arrayBuffer()) };
    },
  };
}

async function googleDriveAdapter(ctx) {
  const token = await getGoogleToken(ctx.sb, ctx.integ, 'drive');
  if (!token) throw Object.assign(new Error('Your Google Drive account is not connected or needs reconnecting.'), { status: 401 });
  const auth = { Authorization: `Bearer ${token}` };
  const FOLDER = 'application/vnd.google-apps.folder';
  return {
    provider: 'googledrive',
    rootId: 'root',
    rootLabel: 'Google Drive',
    async list(folderId) {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', `'${String(folderId).replace(/'/g, '')}' in parents and trashed=false`);
      url.searchParams.set('fields', 'files(id,name,mimeType,size,modifiedTime)');
      url.searchParams.set('pageSize', '200');
      url.searchParams.set('orderBy', 'folder,modifiedTime desc');
      const r = await fetch(url.toString(), { headers: auth });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error?.message || `Could not list folder (${r.status})`);
      return (d.files || []).map(f => ({ id: f.id, name: f.name, folder: f.mimeType === FOLDER, size: Number(f.size) || 0, modified: f.modifiedTime || null, mimeType: f.mimeType }));
    },
    async upload(folderId, name, buffer, mime) {
      const u = await driveUploadFile(token, { parentFolderId: folderId, filename: name, buffer, mimeType: mime });
      return { id: u.id, name: u.name || name, webUrl: u.webViewLink || null };
    },
    async download(itemId) {
      const mr = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(itemId)}?fields=name,mimeType,size`, { headers: auth });
      if (!mr.ok) throw new Error(`Could not read file details (${mr.status})`);
      const meta = await mr.json();
      const native = String(meta.mimeType || '').startsWith('application/vnd.google-apps');
      const url = native
        ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(itemId)}/export?mimeType=application/pdf`
        : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(itemId)}?alt=media`;
      const c = await fetch(url, { headers: auth });
      if (!c.ok) throw new Error(`Could not read the file (${c.status})`);
      return {
        name: native ? `${meta.name}.pdf` : meta.name,
        mimeType: native ? 'application/pdf' : (meta.mimeType || 'application/octet-stream'),
        buffer: Buffer.from(await c.arrayBuffer()),
      };
    },
  };
}
