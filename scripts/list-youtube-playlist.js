// Lista todos los videos de la playlist YouTube de sesiones completas
const fs = require('fs');
const { google } = require('C:/Users/elrub/Desktop/CARPETA CODEX/01_PROYECTOS/RUBEN-COTON_API-GOOGLE/node_modules/googleapis');

const CLIENT = {
  installed: {
    client_id: '994826284966-217klhrvr0drb1dtmk11tev2iiuh84cg.apps.googleusercontent.com',
    client_secret: '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',
    redirect_uris: ['http://localhost']
  }
};
const TOKEN = JSON.parse(fs.readFileSync('C:/Users/elrub/Desktop/CARPETA CODEX/01_PROYECTOS/RUBEN-COTON_API-GOOGLE/config/oauth/token.json','utf8'));
const PLAYLIST_ID = 'PLD__IvI0ALgzV7vgQNb546qEsjLzQMtz5';

async function main() {
  const oauth2 = new google.auth.OAuth2(CLIENT.installed.client_id, CLIENT.installed.client_secret, CLIENT.installed.redirect_uris[0]);
  oauth2.setCredentials(TOKEN);
  const yt = google.youtube({ version: 'v3', auth: oauth2 });

  // Info de la playlist
  const pl = await yt.playlists.list({ part: ['snippet','contentDetails'], id: [PLAYLIST_ID] });
  const playlist = pl.data.items[0];
  console.log(`Playlist: ${playlist.snippet.title}`);
  console.log(`Descripción: ${playlist.snippet.description?.substring(0,200) || '(vacía)'}`);
  console.log(`Vídeos totales: ${playlist.contentDetails.itemCount}`);
  console.log(`Canal: ${playlist.snippet.channelTitle}`);
  console.log('---');

  const videos = [];
  let pageToken = undefined;
  do {
    const r = await yt.playlistItems.list({
      part: ['snippet','contentDetails'],
      playlistId: PLAYLIST_ID,
      maxResults: 50,
      pageToken
    });
    videos.push(...(r.data.items || []));
    pageToken = r.data.nextPageToken;
  } while (pageToken);

  console.log(`Vídeos obtenidos: ${videos.length}\n`);
  // Detalles (duración, views) de cada vídeo
  const ids = videos.map(v => v.contentDetails.videoId);
  const detalles = {};
  for (let i = 0; i < ids.length; i += 50) {
    const r = await yt.videos.list({ part: ['contentDetails','statistics','snippet'], id: ids.slice(i, i+50) });
    for (const v of r.data.items) detalles[v.id] = v;
  }

  const lista = [];
  for (const v of videos) {
    const id = v.contentDetails.videoId;
    const d = detalles[id];
    const dur = d?.contentDetails?.duration || '?';
    const views = d?.statistics?.viewCount || '0';
    const titulo = v.snippet.title;
    const fecha = d?.snippet?.publishedAt?.slice(0,10) || '?';
    console.log(`[${fecha}] ${titulo}  (${dur}, ${views} views)`);
    console.log(`   https://youtu.be/${id}`);
    lista.push({ id, titulo, fecha, duracion: dur, views: parseInt(views) });
  }

  fs.writeFileSync(
    'C:/Users/elrub/Desktop/CARPETA CODEX/01_PROYECTOS/RUBEN-COTON_HTML/config/youtube-playlist-sesiones.json',
    JSON.stringify({
      playlist_id: PLAYLIST_ID,
      url_playlist: `https://www.youtube.com/playlist?list=${PLAYLIST_ID}`,
      titulo: playlist.snippet.title,
      descripcion: playlist.snippet.description || '',
      total: videos.length,
      scanned_at: new Date().toISOString(),
      videos: lista
    }, null, 2)
  );
  console.log('\n✅ Guardado: config/youtube-playlist-sesiones.json');
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
