# חיבור הקול שנבחר — 19 באוקטובר 2026

## הבחירה והפער

המשתמשת מסרה `voice_6ad601faaa188191aa00d6384fc09ca8` וביקשה לחבר אותו לקו. זהו קול שנוצר מתיאור ב־Voices ונבדק ב־GPT‑Live; אינו שכפול של ההקלטה שנשלחה בצ׳אט. לא העלינו את ההקלטה האישית לספק.

התיעוד הרשמי קובע שקולות שנוצרו מתיאור אינם נתמכים ב־Text to Speech או ב־Realtime API הישן. לכן אין לשים מזהה זה ב־MIRKAM_TTS_VOICE או להחליף את שם המודל בנתיב /audio/speech. הקו הקיים ממשיך להשתמש במנוע ההקראה המקורי.

## מה מומש

- `src/mirkam/live-voice.js`: יצירת שיחת GPT‑Live דרך POST /v1/live/sessions, קול קבוע לפי הבחירה, SDP של WebRTC, הוראות עברית ישראלית בוגרת ובקצב רגיל. ללא כלים עסקיים, ללא גישה לתיקי משתמשים וללא משלוחים.
- `/api/admin/live-voice`: בעלת מערכת בלבד; בדיקת הרשאה מחדש אחרי יצירת החיבור, SDP עד 64,000 תווים, בדיקה פעילה אחת ושלושה ניסיונות בעשר דקות. בדיקות ספק נכשלות נספרות; אין ניסיון יצירה חוזר אוטומטי.
- סגירה לאחר שתי דקות באמצעות API הספק; סגירה גם בביטול בזמן ההתחברות. כשל סגירה משאיר את המשבצת תפוסה ומנסה שוב. זוהי הגנה בתהליך השרת, לא הבטחה לחשבון ספק סגור אם השרת או הרשת נופלים.
- ממשק האזנה במערכת הקו: התחלה וסיום, הרשאת מיקרופון, סגירת התקן ביציאה/ניווט/תקלה, ללא חשיפת מפתח API. `store:false` נשלח לספק; אין שמירת תמליל בהיסטוריית הניהול. מדיניות הספק הרגילה עדיין חלה.
- ההאזנה כרוכה בשימוש API בתשלום. נדרש שמפתח השרת יוכל לגשת לקול בפרויקט שבו נוצר, וכן למודל GPT‑Live. אין הוכחה לכך עד ניסיון חי.

## חיבור הטלפון — חסם שנותר

גשר C# הקיים מקבל XML, מייצר WAV, ממיר ל־8kHz ומשמיע קובץ. GPT‑Live משתמש באודיו רציף; הוראה למודל להקריא טקסט אינה מבטיחה הקראה מדויקת או אירוע סיום הקראה. אין להחליף כך את סקירת ההודעות/מסמכים ואישור השליחה.

נוספה בדיקת SDK ללא סודות וללא שיחות: `dotnet Bridge.dll --streaming-api`. בנייה ו־reflection ב־GitHub Actions הצליחו ב־SDK 9.8.3. נבדקו VoiceElements Client/Common/Interface. נמצאו `SetMonitorStream`, `GetMonitorStream`, `StreamMonitorStream`, שינוי RTP ב־SipChannel ו־BotEngage. לא נמצא בבדיקה ממשק WebSocket דו־כיווני מתועד שאפשר לחבר מיד. אין להסיק מכך שלספק אין יכולת כזו: היא מפורסמת באתר, וייתכן שנדרש רכיב/תצורה נוספים.

נדרש מהספק: דוגמת C# ל־AI Live Streaming התואמת ל־Linux/.NET 8 וחשבון הענן הנוכחי; פורמט הודעות WebSocket וקודק לשני הכיוונים; העברת DTMF, עצירת השמעה וניהול תור; הפעלה בחשבון וכתובות/יציאות נדרשות. VNS מתועד עם OpenAI Realtime; אין ראיה שהתצורה הזו תומכת ב־GPT‑Live ובקול שנוצר מתיאור.

אין לעקוף כניסה או אישורי משלוח כדי להדגים קול. ניתוק סביב 303 שניות עדיין פתוח ואינו נפתר על ידי מסלול ההאזנה החדש.

## בדיקות וקבלה

129 בדיקות מקומיות עברו: 10 ספק/חיי חיבור, 3 מיקרופון/ביטול/יציאה, 15 gateway והרשאות, 101 ממשק ניהול. הספק והדפדפן מדומים בבדיקות אלה. בניית .NET אמיתית ב־GitHub הצליחה; אין אימות אודיו או שיחת ספק.

מסלול ההאזנה הוא אופציונלי בלבד; המשתמשת כבר בחרה קול ואין לבקש האזנה נוספת כתנאי להתקדמות בחיבור הטלפון. לאחר פריסה, אם תרצה בכך: לפתוח את אתר הניהול ב־Chrome דרך HTTPS, להיכנס כבעלת מערכת, מערכת הקו, ״הקול שבחרת — שיחת ניסיון״. לאשר מיקרופון ולבדוק עברית, קצב, שיחה וסיום. בדיקה זו אינה אישור שהקול הותקן במספר הטלפון.

## מקורות

- https://developers.openai.com/api/docs/guides/custom-voices
- https://developers.openai.com/api/docs/guides/voice-webrtc
- https://developers.openai.com/api/docs/guides/voice-websockets
- https://developers.openai.com/api/docs/guides/live-conversations
- https://developers.openai.com/api/reference/resources/live/subresources/sessions/methods/hangup
- https://www.nuget.org/packages/InventiveLabs.VoiceElementsClient/9.8.3
- https://www.voiceelements.com/voice-ai-landing/
- https://vns.voiceelements.com/Resources/AzureOpenAI

## ממצא נוסף: רכיב ההזרמה תלוי Windows

ב־19 באוקטובר נבדקה גם הספרייה הנפרדת `VoiceElementsClientStreams.dll` מתוך חבילת 9.8.3. נמצאו `MediaProcessor.StreamEvent`, `OutgoingStream`, `GetIp` ו־`GetPort`. הבדיקה הקודמת של Client/Common/Interface לא כללה אותה ולכן לא הייתה מלאה.

בדיקת המימוש ב־GitHub Actions (run 39256041617) העלתה ש־`MediaProcessor.Init` מפעיל `StreamingApplication.Start`, הקורא ללא תנאי ל־`timeBeginPeriod` מתוך winmm.dll ול־`QueryPerformanceFrequency` מתוך Kernel32.dll. אין בכך הוכחה שכל מוצרי הספק מוגבלים ל־Windows, אך זה חוסם שימוש ישיר ברכיב הזה בשרת Linux הנוכחי. אין להעביר שרת או לפתוח יציאות RTP על סמך השערה.

נוסף מצב `--streaming-platform-check` לאימות התלות המקורית, ללא הגדרות ספק, פתיחת יציאות או שיחות. CI בונה את הגשר ובודק זאת ב־Linux. קוד הקו הפעיל לא הוחלף בממשק לא נתמך.

נוסחה [פנייה טכנית מוכנה לספק](VOICE-ELEMENTS-STREAMING-REQUEST.md) המבקשת מסלול Linux או WebSocket דו־כיווני, דוגמה מדויקת ופרטי מגבלת 300 שניות. הפנייה לא נשלחה. עדיין אין חיבור טלפוני לקול הנבחר; אין לטעון אחרת על בסיס בנייה או בדיקת תלות.

אימות בפועל: GitHub Actions run 39256365200 הסתיים בהצלחה; הגשר נבנה ב־.NET 8 ובדיקת Linux הפיקה `STREAMING_NATIVE_TIMER_UNAVAILABLE`. זו הוכחה לתלות החסרה ברכיב שנבדק, לא בדיקת שיחה או קביעה שאין לספק פתרון Linux חלופי.
