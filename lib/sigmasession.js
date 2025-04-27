import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync } from 'fs';
import { File } from 'megajs';

async function SigmaSessionSavedCredentials(sessionData) {
  try {
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFilePath);
    const credsFilePath = path.join(currentDir, '..', "sessions", "creds.json");
    
    if (typeof sessionData !== 'string') {
      console.error("Invalid input: Session data must be a string");
      return false;
    }

    const isMegaLink = sessionData.startsWith('SIGMA-MD~');
    
    if (!isMegaLink) {
      console.error("Invalid input: Not a valid MEGA.nz session ID. It should start with 'SIGMA-MD~~'");
      return false;
    }

    const sessdata = sessionData.replace("SIGMA-MD~~", '');
    
    console.log("🔄 Downloading Session from MEGA.nz...");
    
    const file = File.fromURL(`https://mega.nz/file/${sessdata}`);
    
    const data = await new Promise((resolve, reject) => {
      file.download((err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    // Verify if the downloaded data is valid JSON
    const parsedData = JSON.parse(data.toString());
    
    writeFileSync(credsFilePath, JSON.stringify(parsedData, null, 2));
    console.log("🔒 Credentials successfully downloaded and saved to creds.json");
    return true;
  } catch (error) {
    console.error("❌ Error in SigmaSessionSavedCredentials:", error);
    return false;
  }
}

export default SigmaSessionSavedCredentials;
