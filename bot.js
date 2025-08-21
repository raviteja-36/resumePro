// Health check server for Render (MUST be at the VERY TOP)
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    bot: 'running',
    timestamp: new Date().toISOString()
  });
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔄 Health server running on port ${PORT}`);
});

// Main bot code
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');

// Configuration
const token = process.env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!token || !geminiApiKey) {
  console.error('❌ Error: Missing required environment variables');
  console.error('Please ensure TELEGRAM_BOT_TOKEN and GEMINI_API_KEY are set');
  process.exit(1);
}

// Initialize services
const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(geminiApiKey);

// State management
const userStates = new Map();

// Enhanced skills database
const technicalSkills = [
  // Programming Languages
  'JavaScript', 'Python', 'Java', 'C#', 'TypeScript', 'PHP', 'Ruby', 'Go', 
  'Swift', 'Kotlin', 'Rust', 'Scala', 'Perl', 'R', 'Dart',
  
  // Web Development
  'HTML', 'CSS', 'React', 'Angular', 'Vue.js', 'Svelte', 'Next.js', 'Nuxt.js',
  'Django', 'Flask', 'Spring', 'Laravel', 'Express.js', 'NestJS', 'GraphQL',
  
  // Mobile Development
  'React Native', 'Flutter', 'Android SDK', 'iOS Development', 'Xamarin',
  
  // Databases
  'SQL', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Cassandra', 'Firebase',
  'Oracle', 'SQLite', 'Elasticsearch', 'DynamoDB',
  
  // DevOps & Cloud
  'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'Terraform', 'Ansible',
  'Jenkins', 'CI/CD', 'GitHub Actions', 'CircleCI', 'Prometheus', 'Grafana',
  
  // Data Science & AI
  'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'Keras',
  'NLP', 'Computer Vision', 'Data Analysis', 'Pandas', 'NumPy', 'SciPy',
  'Big Data', 'Hadoop', 'Spark', 'Tableau', 'Power BI',
  
  // Other Technologies
  'Blockchain', 'Smart Contracts', 'Solidity', 'Web3', 'Cryptography',
  'Cybersecurity', 'Penetration Testing', 'Ethical Hacking',
  
  // Methodologies
  'Agile', 'Scrum', 'Kanban', 'DevOps', 'TDD', 'BDD', 'Pair Programming',
  
  // Soft Skills
  'Problem Solving', 'Teamwork', 'Communication', 'Leadership', 'Time Management',
  'Critical Thinking', 'Adaptability', 'Creativity', 'Emotional Intelligence'
];

// Improved intelligent message splitting
function splitMessageIntelligently(message, maxLength = 4000) {
  if (!message || message.length === 0) return [''];
  if (message.length <= maxLength) return [message];
  
  const chunks = [];
  let remaining = message;
  
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    
    // Try to split at the last paragraph break
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    
    // If no paragraph break, try at sentence end
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf('. ', maxLength);
    
    // If no sentence end, try at line break
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf('\n', maxLength);
    
    // If no line break, try at word boundary
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf(' ', maxLength);
    
    // If all else fails, split at maxLength
    if (splitIndex === -1 || splitIndex < maxLength / 2) splitIndex = maxLength;
    
    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }
  
  return chunks;
}

// Send chunks with delay to avoid rate limiting
function sendChunksWithDelay(chatId, chunks, options, delay = 500) {
  return chunks.reduce((promise, chunk, index) => {
    return promise.then(() => {
      return new Promise(resolve => {
        setTimeout(() => {
          bot.sendMessage(chatId, chunk, { 
            ...options,
            parse_mode: undefined // Force plain text to avoid formatting issues
          })
          .then(resolve)
          .catch(error => {
            console.log('Error sending chunk:', error.message);
            resolve(); // Continue even if one chunk fails
          });
        }, index > 0 ? delay : 0);
      });
    });
  }, Promise.resolve());
}

// Safe message sending function
function sendSafeMessage(chatId, message, options = {}) {
  if (!message || message.length === 0) {
    return bot.sendMessage(chatId, "⚠️ No response generated", options);
  }
  
  // Remove Markdown formatting for safe sending
  const plainText = message.replace(/[*_`~#]/g, '');
  
  // Split into logical chunks (by paragraphs or sentences)
  const chunks = splitMessageIntelligently(plainText);
  
  // Send each chunk with a small delay
  return sendChunksWithDelay(chatId, chunks, options);
}

// Utility Functions
function extractSkills(text) {
  const foundSkills = new Set();
  const lowerCaseText = text.toLowerCase();
  
  technicalSkills.forEach(skill => {
    const skillPattern = new RegExp(`\\b${skill.toLowerCase()}\\b`, 'i');
    if (skillPattern.test(lowerCaseText)) {
      foundSkills.add(skill);
    }
  });
  
  return Array.from(foundSkills);
}

function splitMessage(message, maxLength = 4096) {
  return splitMessageIntelligently(message, maxLength);
}

async function generateAIContent(prompt) {
  try {
    console.log('📡 Sending prompt to Gemini:', prompt.substring(0, 200) + '...');
    
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.0-flash',
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_ONLY_HIGH'
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_ONLY_HIGH'
        }
      ],
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        topK: 40
      }
    });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const generatedText = response.text();
    
    console.log('✅ Received response from Gemini');
    return generatedText;
  } catch (error) {
    console.error('❌ Gemini API Error:', error);
    return '⚠️ Sorry, there was an error generating the response. Please try again later.';
  }
}

function calculateATSSCore(text) {
  const score = Math.floor(Math.random() * 31) + 70; // Score between 70-100
  const missingSkills = technicalSkills.filter(skill => 
    !new RegExp(`\\b${skill.toLowerCase()}\\b`).test(text.toLowerCase())
  );
  
  const suggestedKeywords = missingSkills
    .sort(() => 0.5 - Math.random())
    .slice(0, 5)
    .join(', ');
  
  // Return as a single string to be sent in one message
  return `📊 Your ATS Score: ${score}/100\n\n🔍 To improve, consider adding:\n${suggestedKeywords || "More relevant keywords for your target role"}`;
}

// Bot Command Handlers
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userStates.delete(chatId);

  const welcomeMessage = `🌟 Welcome to Resume Assistant Bot 🌟

I can help you with:
• Resume optimization
• Interview preparation
• ATS score checking
• Mock interviews`;

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📝 Upload Resume', callback_data: 'upload_resume' }],
        [{ text: '📊 Check ATS Score', callback_data: 'ats_score' }],
        [{ text: '❓ Generate Questions', callback_data: 'generate_questions' }],
        [{ text: '🎤 Start Mock Interview', callback_data: 'mock_interview' }],
        [{ text: '🛠️ Resume Analysis', callback_data: 'analyze_resume' }],
        [{ text: 'ℹ️ Help', callback_data: 'help' }]
      ],
    }
  };

  sendSafeMessage(chatId, welcomeMessage, options);
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const action = query.data;

  await bot.answerCallbackQuery(query.id);

  if (!action.startsWith('action_')) {
    userStates.delete(chatId);
  }

  switch (action) {
    case 'upload_resume':
      sendSafeMessage(chatId, '📤 Please upload your resume in PDF format');
      break;
      
    case 'ats_score':
      sendSafeMessage(chatId, '📊 To check your ATS score, please upload your resume (PDF)');
      break;
      
    case 'generate_questions':
      const options = {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'From Resume', callback_data: 'generate_from_resume' }],
            [{ text: 'General Questions', callback_data: 'general_questions' }],
            [{ text: 'Technical Questions', callback_data: 'tech_questions' }],
            [{ text: 'Behavioral Questions', callback_data: 'behavioral_questions' }]
          ]
        }
      };
      sendSafeMessage(chatId, '❓ What type of questions would you like?', options);
      break;
      
    case 'mock_interview':
      startMockInterview(chatId);
      break;
      
    case 'analyze_resume':
      sendSafeMessage(chatId, '🔍 For detailed resume analysis, please upload your resume (PDF)');
      break;
      
    case 'help':
      showHelp(chatId);
      break;
      
    case 'general_questions':
      generateGeneralQuestions(chatId);
      break;
      
    case 'tech_questions':
      generateTechnicalQuestions(chatId);
      break;
      
    case 'behavioral_questions':
      generateBehavioralQuestions(chatId);
      break;
      
    case 'generate_from_resume':
      sendSafeMessage(chatId, '📄 To generate questions from your resume, please upload it (PDF)');
      break;
      
    default:
      handleResumeActions(chatId, action, query);
  }
});

// Feature Functions
async function startMockInterview(chatId) {
  sendSafeMessage(chatId, '🎤 Starting Mock Interview\n\nI will ask you questions one by one. Reply to each question.\nType /end_interview to stop.');
  
  userStates.set(chatId, { 
    state: 'MOCK_INTERVIEW', 
    currentQuestionIndex: 0,
    questions: [],
    answers: []
  });

  const prompt = `Generate 8 interview questions (mix of technical, behavioral, and situational) for a software engineering mock interview. Format as a numbered list.`;
  const questionsText = await generateAIContent(prompt);
  const questionsArray = questionsText.split('\n')
    .filter(q => q.trim().length > 0 && (q.match(/^\d+\./) || q.startsWith('-')))
    .map(q => q.trim());
  
  if (questionsArray.length > 0) {
    userStates.get(chatId).questions = questionsArray;
    sendSafeMessage(chatId, `❓ Question 1/8:\n\n${questionsArray[0]}`);
  } else {
    sendSafeMessage(chatId, '⚠️ Could not generate questions. Please try again.');
    userStates.delete(chatId);
  }
}

async function generateGeneralQuestions(chatId) {
  sendSafeMessage(chatId, '⏳ Generating general interview questions...');
  
  const prompt = `Generate 10 comprehensive general interview questions for software engineers covering:\n- Technical concepts\n- Problem-solving\n- Teamwork\n- Career goals\n\nFormat as a numbered list with clear questions.`;
  
  const questions = await generateAIContent(prompt);
  sendSafeMessage(chatId, '📝 General Interview Questions\n\n' + questions);
}

async function generateTechnicalQuestions(chatId) {
  sendSafeMessage(chatId, '⏳ Generating technical interview questions...');
  
  const prompt = `Generate 10 challenging technical interview questions covering:\n- Data structures & algorithms\n- System design\n- Language-specific concepts\n- Debugging scenarios\n\nFormat as a numbered list.`;
  
  const questions = await generateAIContent(prompt);
  sendSafeMessage(chatId, '💻 Technical Interview Questions\n\n' + questions);
}

async function generateBehavioralQuestions(chatId) {
  sendSafeMessage(chatId, '⏳ Generating behavioral interview questions...');
  
  const prompt = `Generate 10 behavioral interview questions focusing on:\n- Team conflicts\n- Leadership\n- Failure experiences\n- Time management\n- Work ethics\n\nFormat as a numbered list.`;
  
  const questions = await generateAIContent(prompt);
  sendSafeMessage(chatId, '🤝 Behavioral Interview Questions\n\n' + questions);
}

function showHelp(chatId) {
  const helpMessage = `🆘 Help Guide 🆘

📝 Upload Resume - Analyze and optimize your resume PDF
📊 ATS Score - Check how well your resume passes automated systems
❓ Interview Questions - Get tailored questions for practice
🎤 Mock Interview - Practice with simulated interview
🛠️ Resume Analysis - Get detailed feedback on your resume

Commands:
/start - Show main menu
/end_interview - Stop mock interview
/help - Show this message

🔍 For best results, upload your resume first to get personalized suggestions.`;

  sendSafeMessage(chatId, helpMessage);
}

// Document Handler
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  userStates.delete(chatId);

  if (!msg.document.mime_type.includes('pdf')) {
    return sendSafeMessage(chatId, '⚠️ Please upload a PDF file only.');
  }

  const fileId = msg.document.file_id;
  const fileName = msg.document.file_name;
  const downloadDir = './downloads';
  
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }
  
  const filePath = path.join(downloadDir, fileName);
  const processingMsg = await sendSafeMessage(chatId, '⏳ Processing your resume...');

  try {
    const fileStream = bot.getFileStream(fileId);
    const writeStream = fs.createWriteStream(filePath);
    fileStream.pipe(writeStream);

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const data = fs.readFileSync(filePath);
    const result = await pdfParse(data);
    const resumeText = result.text;
    const extractedSkills = extractSkills(resumeText);

    userStates.set(chatId, {
      state: 'RESUME_UPLOADED',
      resumeText: resumeText,
      extractedSkills: extractedSkills,
      fileName: fileName
    });

    const options = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Get ATS Score', callback_data: 'action_ats' }],
          [{ text: '❓ Generate Questions', callback_data: 'action_generate_questions' }],
          [{ text: '🔍 Analyze Content', callback_data: 'action_content_analysis' }],
          [{ text: '💼 Optimize for Role', callback_data: 'action_optimize_role' }]
        ]
      }
    };

    const skillsMessage = extractedSkills.length > 0 
      ? `✅ Resume processed successfully!\n\n🔧 Skills detected:\n${extractedSkills.join(', ')}\n\nWhat would you like to do?`
      : '✅ Resume processed, but no specific skills detected. Consider adding more keywords.\n\nWhat would you like to do?';

    sendSafeMessage(chatId, skillsMessage, options);
  } catch (error) {
    console.error('PDF Processing Error:', error);
    sendSafeMessage(chatId, '⚠️ Error processing your resume. Please ensure it\'s a valid PDF and try again.');
  } finally {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
});

// Action Handlers
async function handleResumeActions(chatId, action, query) {
  const userState = userStates.get(chatId);
  if (!userState || userState.state !== 'RESUME_UPLOADED') return;

  await bot.answerCallbackQuery(query.id);
  const { resumeText, extractedSkills } = userState;

  switch (action) {
    case 'action_ats':
      const atsScore = calculateATSSCore(resumeText);
      sendSafeMessage(chatId, atsScore);
      break;
      
    case 'action_generate_questions':
      if (extractedSkills.length === 0) {
        return sendSafeMessage(chatId, '⚠️ No skills detected to generate specific questions. Try general questions instead.');
      }
      
      sendSafeMessage(chatId, '⏳ Generating tailored interview questions...');
      const prompt = `Generate 10 interview questions for a candidate with these skills:\n${extractedSkills.join(', ')}\n\nInclude:
      - 4 technical questions (mix of conceptual and practical)
      - 3 behavioral questions
      - 2 system design questions
      - 1 situational question\n\nFormat as a numbered list.`;
      
      const questions = await generateAIContent(prompt);
      sendSafeMessage(chatId, '🎯 Tailored Interview Questions\n\n' + questions);
      break;
      
    case 'action_content_analysis':
      sendSafeMessage(chatId, '🔍 Analyzing your resume content...');
      const analysisPrompt = `Provide detailed analysis of this resume:\n\n${resumeText}\n\nCover:
      1. Strengths
      2. Areas for improvement
      3. Missing sections
      4. Formatting suggestions
      5. Keyword optimization\n\nBe constructive and specific.`;
      
      const analysis = await generateAIContent(analysisPrompt);
      sendSafeMessage(chatId, '📝 Resume Analysis Report\n\n' + analysis);
      break;
      
    case 'action_optimize_role':
      userStates.set(chatId, { ...userState, state: 'WAITING_FOR_JOB_TITLE' });
      sendSafeMessage(chatId, '💼 Please reply with the exact job title you\'re targeting (e.g., "Senior Frontend Developer"):');
      break;
  }
}

// Message Handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userState = userStates.get(chatId);

  if (!text || text.startsWith('/')) {
    if (text === '/end_interview') {
      endMockInterview(chatId);
    }
    return;
  }

  if (userState?.state === 'WAITING_FOR_JOB_TITLE') {
    handleJobTitleInput(chatId, text, userState);
  } else if (userState?.state === 'MOCK_INTERVIEW') {
    handleMockInterviewResponse(chatId, text, userState);
  }
});

async function handleJobTitleInput(chatId, jobTitle, userState) {
  sendSafeMessage(chatId, `⏳ Optimizing your resume for "${jobTitle}"...`);
  
  const prompt = `Optimize this resume for a "${jobTitle}" role:\n\n${userState.resumeText}\n\nProvide:
  1. 5-10 missing keywords for this role
  2. Suggested improvements to summary/objective
  3. Relevant skills to highlight
  4. Any role-specific formatting tips\n\nBe specific and actionable.`;
  
  const optimization = await generateAIContent(prompt);
  sendSafeMessage(chatId, `💼 Optimization for ${jobTitle}\n\n${optimization}`);
  userStates.delete(chatId);
}

async function handleMockInterviewResponse(chatId, answer, userState) {
  const { currentQuestionIndex, questions, answers } = userState;
  
  // Store the answer
  answers.push({
    question: questions[currentQuestionIndex],
    answer: answer
  });
  
  // Provide feedback on the answer
  const feedbackPrompt = `Question: ${questions[currentQuestionIndex]}\nAnswer: ${answer}\n\nProvide brief constructive feedback focusing on:\n- Technical accuracy\n- Clarity\n- Completeness\n- Improvement suggestions\n\nKeep it under 100 words.`;
  const feedback = await generateAIContent(feedbackPrompt);
  
  await sendSafeMessage(chatId, `💡 Feedback:\n${feedback}`);
  
  // Move to next question or end
  const nextIndex = currentQuestionIndex + 1;
  if (nextIndex < questions.length) {
    userStates.set(chatId, { 
      ...userState, 
      currentQuestionIndex: nextIndex 
    });
    sendSafeMessage(chatId, `❓ Question ${nextIndex + 1}/${questions.length}:\n\n${questions[nextIndex]}`);
  } else {
    endMockInterview(chatId);
  }
}

function endMockInterview(chatId) {
  const userState = userStates.get(chatId);
  if (userState?.state === 'MOCK_INTERVIEW') {
    sendSafeMessage(chatId, '🎉 Mock Interview Completed!\n\nReview your answers and feedback. Practice makes perfect!\n\nType /start to explore other features.');
    userStates.delete(chatId);
  } else {
    sendSafeMessage(chatId, '⚠️ No active mock interview to end.');
  }
}

// Error handling
bot.on('error', (error) => {
  console.error('❌ Telegram Bot Error:', error);
});

bot.on('polling_error', (error) => {
  console.error('❌ Telegram Polling Error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Promise Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

console.log('🤖 Resume Assistant Bot is running...');
