const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle
} = require('docx');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function sendEmailNotification(userEmail, templateName, conversationSummary) {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'victoria@druaconsulting.com';
  if (!SENDGRID_API_KEY) return;

  const emailBody = {
    personalizations: [{ to: [{ email: FROM_EMAIL }] }],
    from: { email: FROM_EMAIL, name: 'Drua AI System' },
    subject: `🔔 New Template Generated: ${templateName}`,
    content: [{
      type: 'text/html',
      value: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9;">
          <div style="background: #0a1628; padding: 24px; border-radius: 8px 8px 0 0;">
            <h1 style="color: #c9a84c; margin: 0; font-size: 1.4rem;">DRUA — New Template Generated</h1>
          </div>
          <div style="background: white; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #eee;">
            <p><strong>Template Type:</strong> ${templateName}</p>
            <p><strong>User Email:</strong> ${userEmail}</p>
            <p><strong>Generated At:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
            <h3 style="color: #0a1628;">Consultation Summary:</h3>
            <div style="background: #f5f5f5; padding: 16px; border-radius: 4px; font-size: 0.9rem; white-space: pre-wrap;">${conversationSummary}</div>
            <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
            <p style="color: #666; font-size: 0.85rem;">This user may need your expert review. Reply to this email or contact them at <a href="mailto:${userEmail}">${userEmail}</a>.</p>
          </div>
        </div>
      `
    }]
  };

  await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(emailBody)
  });
}

const TEMPLATES = {
  '510k': {
    name: 'FDA 510(k) Premarket Notification',
    sections: [
      { title: '1. Cover Sheet', key: 'cover', placeholder: 'Device name, applicant info, submission date' },
      { title: '2. Indications for Use', key: 'indications', placeholder: 'Describe intended use and indications' },
      { title: '3. Device Description', key: 'device_description', placeholder: 'Detailed device description and technology' },
      { title: '4. Substantial Equivalence Discussion', key: 'substantial_equivalence', placeholder: 'Predicate device comparison and equivalence argument' },
      { title: '5. Performance Testing Summary', key: 'performance_testing', placeholder: 'Bench, animal, and/or clinical testing results' },
      { title: '6. Biocompatibility', key: 'biocompatibility', placeholder: 'ISO 10993 biocompatibility evaluation' },
      { title: '7. Software Documentation', key: 'software', placeholder: 'Software level of concern and documentation (if applicable)' },
      { title: '8. Sterilization and Shelf Life', key: 'sterilization', placeholder: 'Sterilization method and validation (if applicable)' },
      { title: '9. Proposed Labeling', key: 'labeling', placeholder: 'Draft labeling including intended use, contraindications, warnings' },
      { title: '10. Conclusion', key: 'conclusion', placeholder: 'Summary of substantial equivalence determination' }
    ]
  },
  'presub': {
    name: 'FDA Pre-Submission (Q-Sub) Meeting Request',
    sections: [
      { title: '1. Cover Sheet', key: 'cover', placeholder: 'Applicant info, device name, submission type' },
      { title: '2. Product Description', key: 'product', placeholder: 'Brief description of device and its intended use' },
      { title: '3. Regulatory Background', key: 'background', placeholder: 'Current regulatory status and history' },
      { title: '4. Type of Submission Planned', key: 'submission_type', placeholder: '510(k), PMA, De Novo, etc.' },
      { title: '5. Proposed Questions for FDA', key: 'questions', placeholder: 'Specific questions to be discussed with FDA' },
      { title: '6. Supporting Data Summary', key: 'supporting_data', placeholder: 'Preliminary data supporting the questions' },
      { title: '7. Requested Meeting Format', key: 'meeting_format', placeholder: 'In-person, teleconference, or written response only' }
    ]
  },
  '513g': {
    name: 'FDA 513(g) Request for Device Classification Information',
    sections: [
      { title: '1. Cover Sheet', key: 'cover', placeholder: 'Applicant info, device name, contact information' },
      { title: '2. Device Description', key: 'device_description', placeholder: 'Detailed description of device components and materials' },
      { title: '3. Intended Use and Indications', key: 'intended_use', placeholder: 'How and why the device will be used' },
      { title: '4. Device Classification Question', key: 'classification', placeholder: 'Specific classification questions for FDA' },
      { title: '5. Regulatory History', key: 'reg_history', placeholder: 'Any prior FDA submissions or interactions' },
      { title: '6. Comparable Devices', key: 'comparable', placeholder: 'Similar legally marketed devices, if known' },
      { title: '7. Supporting Information', key: 'supporting', placeholder: 'Technical data, references, literature' }
    ]
  },
  'denovo': {
    name: 'FDA De Novo Classification Request',
    sections: [
      { title: '1. Cover Sheet', key: 'cover', placeholder: 'Applicant info, device name, submission date' },
      { title: '2. Executive Summary', key: 'executive_summary', placeholder: 'Brief overview of the device and De Novo request' },
      { title: '3. Device Description', key: 'device_description', placeholder: 'Detailed description of device, components, materials, and technology' },
      { title: '4. Intended Use and Indications for Use', key: 'intended_use', placeholder: 'Intended use, target population, conditions of use' },
      { title: '5. Proposed Classification and Special Controls', key: 'classification', placeholder: 'Proposed device type, product code, and special controls' },
      { title: '6. Why 510(k) is Not Appropriate', key: 'equivalence', placeholder: 'Explanation of why no predicate exists' },
      { title: '7. Risk Analysis', key: 'risk_analysis', placeholder: 'Risks to health and proposed mitigations' },
      { title: '8. Performance Testing', key: 'performance_testing', placeholder: 'Bench, biocompatibility, clinical testing summary' },
      { title: '9. Proposed Special Controls', key: 'special_controls', placeholder: 'Controls that provide reasonable assurance of safety and effectiveness' },
      { title: '10. Labeling', key: 'labeling', placeholder: 'Draft labeling, IFU, warnings' },
      { title: '11. Conclusion', key: 'conclusion', placeholder: 'Summary supporting De Novo classification' }
    ]
  }
}
};

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const token = (event.headers.authorization || '').replace('Bearer ', '');
    const { data: { user }, error: authError } = await sb.auth.getUser(token);
    if (authError || !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

    const { templateType, conversation } = JSON.parse(event.body);
    const template = TEMPLATES[templateType];
    if (!template) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown template type' }) };

    const conversationText = conversation
      .map(m => `${m.role === 'user' ? 'User' : 'Drua AI'}: ${m.text}`)
      .join('\n\n');

    const prompt = `You are a regulatory affairs expert. Based on the following conversation between a user and Drua (a medical device regulatory AI), fill in each section of a ${template.name} template.

CONVERSATION:
${conversationText}

Fill in each section below using information from the conversation. Where information was not discussed, write "[TO BE COMPLETED BY APPLICANT: brief description of what's needed]". Be professional, thorough, and use proper FDA regulatory language.

Return ONLY a valid JSON object with these exact keys:
${template.sections.map(s => `"${s.key}": "content for ${s.title}"`).join(',\n')}

JSON only, no markdown, no explanation.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    let sections;
    try {
      const raw = response.content[0].text.replace(/```json|```/g, '').trim();
      sections = JSON.parse(raw);
    } catch {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to parse template content' }) };
    }

    const children = [];

    children.push(
      new Paragraph({
        text: template.name,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: 'CONFIDENTIAL DRAFT — FOR REVIEW PURPOSES ONLY', bold: true, color: 'C0392B', size: 20 })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Generated by Drua Regulatory AI | ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
            color: '666666',
            size: 18,
            italics: true
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: 'This document was auto-generated based on your consultation with Drua AI. All sections marked [TO BE COMPLETED] require your input. This draft must be reviewed and validated by a qualified regulatory professional before submission to FDA.',
            color: '888888',
            size: 18,
            italics: true
          })
        ],
        spacing: { after: 800 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } }
      })
    );

    for (const section of template.sections) {
      const content = sections[section.key] || '[TO BE COMPLETED BY APPLICANT]';

      children.push(
        new Paragraph({
          text: section.title,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 200 }
        })
      );

      const paragraphs = content.split('\n').filter(p => p.trim());
      for (const para of paragraphs) {
        const isPlaceholder = para.includes('[TO BE COMPLETED');
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: para,
                color: isPlaceholder ? 'E74C3C' : '2C3E50',
                italics: isPlaceholder,
                size: 22
              })
            ],
            spacing: { after: 160 }
          })
        );
      }
    }

    children.push(
      new Paragraph({ text: '', spacing: { before: 600 } }),
      new Paragraph({
        children: [
          new TextRun({ text: 'Next Steps: ', bold: true, size: 20 }),
          new TextRun({
            text: '(1) Complete all sections marked [TO BE COMPLETED BY APPLICANT] using the Drua chatbot for guidance. (2) Return to the chatbot and purchase an Expert Review service. (3) Upload this completed document for Victoria\'s professional review before FDA submission. Questions? Contact victoria@druaconsulting.com',
            size: 20
          })
        ],
        border: { top: { style: BorderStyle.SINGLE, size: 1, color: 'C9A84C' } },
        spacing: { before: 200 }
      })
    );

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        children
      }]
    });

    const buffer = await Packer.toBuffer(doc);

    const conversationSummary = conversation
      .slice(-10)
      .map(m => `${m.role === 'user' ? '👤 User' : '🤖 Drua'}: ${m.text.substring(0, 200)}${m.text.length > 200 ? '...' : ''}`)
      .join('\n\n');
    await sendEmailNotification(user.email, template.name, conversationSummary).catch(e => console.error('Email error:', e));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        docx_base64: buffer.toString('base64'),
        filename: `Drua_${templateType.toUpperCase()}_Template_${Date.now()}.docx`
      })
    };

  } catch (err) {
    console.error('generate-template error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
