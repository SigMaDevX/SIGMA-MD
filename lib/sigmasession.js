import { fileURLToPath } from 'url';
import path from 'path';
import { writeFileSync } from 'fs';
import { File } from 'megajs';

async function SigmaSessionSavedCredentials(sessionData) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  // Check if sessionData is a MEGA link
  if (!sessionData.startsWith('SIGMA-MD~')) {
    console.error("Invalid input: Session data must start with 'SIGMA-MD~'");
    return;
  }

  // Remove prefix and check format
  const megaData = sessionData.replace("SIGMA-MD~", '');
  if (!megaData.includes('#')) {
    console.error("Invalid MEGA format: Must contain FILEID#FILEKEY after SIGMA-MD~");
    return;
  }

  try {
    // Create proper MEGA URL
    const megaUrl = `https://mega.nz/file/${megaData}`;
    console.log("Attempting to download from MEGA URL:", megaUrl);

    // Initialize MEGA file
    const file = File.fromURL(megaUrl);
    
    // Download file content
    const fileContent = await new Promise((resolve, reject) => {
      file.loadAttributes((err) => {
        if (err) return reject(err);
        
        file.download((err, data) => {
          if (err) return reject(err);
          resolve(data.toString());
        });
      });
    });

    // Parse and save credentials
    const credsPath = path.join(__dirname, '..', "sessions", "creds.json");
    const jsonData = JSON.parse(fileContent);
    writeFileSync(credsPath, JSON.stringify(jsonData, null, 2));
    console.log("✅ Credentials successfully saved to creds.json");

  } catch (error) {
    console.error("❌ Error processing MEGA session:", error.message);
    if (error.message.includes('no valid key')) {
      console.error("Please verify your MEGA file key is correct");
    }
  }
}

export default SigmaSessionSavedCredentials;
