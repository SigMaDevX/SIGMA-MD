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
    try {
      // Extract the MEGA file ID and key
      const megaUrlPart = sessionData.replace("SIGMA-MD~", '');
      
      // Construct full MEGA URL
      const megaUrl = `https://mega.nz/file/${megaUrlPart}`;
      
      // Initialize MEGA file
      const file = File.fromURL(megaUrl);
      
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
      console.error("Error downloading from MEGA:", error.message);
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
      console.error("Invalid JSON format in downloaded data:", error.message);
      return;
    }
    
    writeFileSync(credsPath, JSON.stringify(jsonData, null, 2));
    console.log("Credentials saved to creds.json");
  } catch (error) {
    console.error("Error saving credentials:", error.message);
  }
}

export default SigmaSessionSavedCredentials;
