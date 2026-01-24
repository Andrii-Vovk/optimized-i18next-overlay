import { logger } from "./logger";

/**
 * Translate text using Google Translate API (free endpoint)
 * @param text Text to translate
 * @param targetLang Target language code (e.g., 'es', 'fr', 'de')
 * @param sourceLang Source language code (default: 'en')
 * @returns Translated text
 */
export async function translateText(
  text: string,
  targetLang: string,
  sourceLang: string = "en"
): Promise<string> {
  try {
    // Use Google Translate free API endpoint
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Translation API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // The API returns an array where the first element contains translation arrays
    // Each translation array has the translated text at index 0
    if (Array.isArray(data) && data[0] && Array.isArray(data[0])) {
      const translatedParts: string[] = [];
      for (const item of data[0]) {
        if (Array.isArray(item) && item[0]) {
          translatedParts.push(item[0]);
        }
      }
      const translatedText = translatedParts.join("");
      logger.debug("Translation successful", { text, targetLang, translatedText });
      return translatedText;
    }

    throw new Error("Unexpected response format from translation API");
  } catch (error) {
    logger.error("Translation failed", error);
    throw error;
  }
}

/**
 * Map locale codes to Google Translate language codes
 * Some locales might need conversion (e.g., 'en-US' -> 'en')
 */
export function getGoogleTranslateLangCode(locale: string): string {
  // Extract base language code (e.g., 'en' from 'en-US')
  const baseLang = locale.split("-")[0].toLowerCase();
  return baseLang;
}
