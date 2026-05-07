// Lista contenido de la carpeta Drive de promotores
const fs = require('fs');
const { google } = require('C:/Users/elrub/Desktop/CARPETA CODEX/01_PROYECTOS/RUBEN-COTON_API-GOOGLE/node_modules/googleapis');

// Client credentials desde el .env de RUBEN-COTON_API-GOOGLE
const CLIENT = {
  installed: {
    client_id: '994826284966-217klhrvr0drb1dtmk11tev2iiuh84cg.apps.googleusercontent.com',
    client_secret: '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',
    redirect_uris: ['http://localhost']
  }
};
const TOKEN = JSON.parse(fs.readFileSync('C:/Users/elrub/Desktop/CARPETA CODEX/01_PROYECTOS/RUBEN-COTON_API-GOOGLE/config/oauth/token.json','utf8'));

const FOLDER_ID = '1RLLG0n08oeRf6SjiF6prIFx5UKMho4sX';

async function main() {
  const oauth2 = new google.auth.OAuth2(
    CLIENT.installed.client_id,
    CLIENT.installed.client_secret,
    CLIENT.installed.redirect_uris[0]
  );
  oauth2.setCredentials(TOKEN);
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  console.log('Listando carpeta', FOLDER_ID);
  const items = [];
  let pageToken = undefined;
  do {
    const r = await drive.files.list({
      q: `'${FOLDER_ID}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, description, webViewLink)',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken
    });
    items.push(...(r.data.files || []));
    pageToken = r.data.nextPageToken;
  } while (pageToken);

  console.log(`\nTotal items: ${items.length}\n`);
  for (const f of items) {
    const tipo = f.mimeType === 'application/vnd.google-apps.folder' ? '📁' :
                 f.mimeType.startsWith('image/') ? '🖼️' :
                 f.mimeType.startsWith('video/') ? '🎬' :
                 f.mimeType.startsWith('audio/') ? '🎵' :
                 f.mimeType === 'application/pdf' ? '📄' : '📎';
    const sz = f.size ? `${(f.size/1024/1024).toFixed(1)}MB` : '-';
    console.log(`${tipo} ${f.name}  [${sz}]  ${f.modifiedTime?.slice(0,10)}`);
    console.log(`   id: ${f.id}`);
    if (f.description) console.log(`   desc: ${f.description}`);
    console.log(`   ${f.webViewLink}`);
  }

  // Si hay subcarpetas, listarlas también
  const subs = items.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
  for (const sub of subs) {
    console.log(`\n--- 📁 ${sub.name} (subcarpeta) ---`);
    const r = await drive.files.list({
      q: `'${sub.id}' in parents and trashed = false`,
      fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)',
      pageSize: 100,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    });
    for (const f of (r.data.files || [])) {
      const sz = f.size ? `${(f.size/1024/1024).toFixed(1)}MB` : '-';
      console.log(`  ${f.name}  [${sz}]  → ${f.webViewLink}`);
    }
  }
  fs.writeFileSync('C:/Users/elrub/Desktop/CARPETA CODEX/01_PROYECTOS/RUBEN-COTON_HTML/config/promotores-folder.json', JSON.stringify({ folderId: FOLDER_ID, scannedAt: new Date().toISOString(), items }, null, 2));
  console.log('\n✅ Guardado: config/promotores-folder.json');
}
main().catch(e => { console.error(e.message); process.exit(1); });
