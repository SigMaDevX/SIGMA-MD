import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync } from 'fs';
import { File } from 'megajs';

async function SigmaSessionSavedCredentials(sessionData) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  let fileContent;
  const isMegaLink = sessionData.startsWith('SIGMA-MD~');
  
  if (isMegaLink) {
    const megaFileId = sessionData.replace("SIGMA-MD~", '');
    try {
      const file = File.fromURL(`https://mega.nz/file/${megaFileId}`);
      
      // Download the file content
      fileContent = await new Promise((resolve, reject) => {
        file.download((err, data) => {
          if (err) {
            reject(err);
          } else {
            resolve(data.toString());
          }
        });
      });
      
    } catch (error) {
      console.error("Error downloading from MEGA:", error);
      return;
    }
  } else {
    console.error("Invalid input: Not a valid MEGA file ID.");
    return;
  }
  
  try {
    const credsPath = path.join(__dirname, '..', "sessions", "creds.json");
    let jsonData;
    
    try {
      jsonData = JSON.parse(fileContent);
    } catch (error) {
      console.error("Invalid JSON format in downloaded data:", error);
      return;
    }
    
    writeFileSync(credsPath, JSON.stringify(jsonData, null, 2));
    console.log("Credentials saved to creds.json");
  } catch (error) {
    console.error("Error saving credentials:", error);
  }
}

export default SigmaSessionSavedCredentials;
