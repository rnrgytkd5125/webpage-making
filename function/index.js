const functions = require('firebase-functions');
const cors = require('cors')({origin: true});
const Parser = require('rss-parser');
const { google } = require('googleapis');

/* 블로그 */
exports.getBlogRss = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const parser = new Parser();
      const feed = await parser.parseURL('https://rss.blog.naver.com/rnrgytkd320.xml');
      
      const posts = feed.items.slice(0, 8).map(item => {
        let image = '';
        const imgMatch = item.content?.match(/<img[^>]+src="([^">]+)"/);
        if (imgMatch) {
          image = imgMatch[1];
        }
        
        const date = new Date(item.pubDate);
        const formattedDate = date.toLocaleDateString('ko-KR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        
        return {
          title: item.title,
          link: item.link,
          date: formattedDate,
          image: image,
          description: item.contentSnippet?.substring(0, 150) || ''
        };
      });
      
      res.json({
        success: true,
        posts: posts
      });
    } catch (error) {
      console.error('Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});


const calendar = google.calendar('v3');

const auth = new google.auth.GoogleAuth({
  keyFile: './service-account-key.json',
  scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
});

// 월별 일정 가져오기
exports.getMonthlySchedule = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { year, month } = req.query;
      
      if (!year || !month) {
        return res.status(400).json({ 
          error: 'year와 month 파라미터가 필요합니다' 
        });
      }

      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      const authClient = await auth.getClient();
      
      const response = await calendar.events.list({
        auth: authClient,
        calendarId: '0c6dbc00f7fa829fe39c720dc8a44f4c6bda786f9972b21b52d27fb9644a3c5d@group.calendar.google.com',
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      
      const scheduleByDate = {};
      
      events.forEach(event => {
        const startDateTime = event.start.dateTime || event.start.date;
        const date = new Date(startDateTime);
        const day = date.getDate();
        
        if (!scheduleByDate[day]) {
          scheduleByDate[day] = [];
        }
        
        scheduleByDate[day].push({
          id: event.id,
          title: event.summary,
          description: event.description || '',
          location: event.location || '',
          startTime: event.start.dateTime || event.start.date,
          endTime: event.end.dateTime || event.end.date,
          likes: 0
        });
      });

      return res.status(200).json({
        success: true,
        year: parseInt(year),
        month: parseInt(month),
        schedules: scheduleByDate
      });

    } catch (error) {
      console.error('Error fetching calendar events:', error);
      return res.status(500).json({ 
        error: '일정을 가져오는데 실패했습니다',
        details: error.message 
      });
    }
  });
});

// 일별 일정 가져오기
exports.getDailySchedule = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { year, month, day } = req.query;
      
      if (!year || !month || !day) {
        return res.status(400).json({ 
          error: 'year, month, day 파라미터가 필요합니다' 
        });
      }

      const startDate = new Date(year, month - 1, day, 0, 0, 0);
      const endDate = new Date(year, month - 1, day, 23, 59, 59);

      const authClient = await auth.getClient();
      
      const response = await calendar.events.list({
        auth: authClient,
        calendarId: '0c6dbc00f7fa829fe39c720dc8a44f4c6bda786f9972b21b52d27fb9644a3c5d@group.calendar.google.com',
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
      });

      const events = response.data.items || [];
      
      const schedules = events.map(event => ({
        id: event.id,
        title: event.summary,
        description: event.description || '',
        location: event.location || '',
        startTime: event.start.dateTime || event.start.date,
        endTime: event.end.dateTime || event.end.date,
        likes: 0
      }));

      return res.status(200).json({
        success: true,
        date: `${year}-${month}-${day}`,
        schedules: schedules
      });

    } catch (error) {
      console.error('Error fetching daily events:', error);
      return res.status(500).json({ 
        error: '일정을 가져오는데 실패했습니다',
        details: error.message 
      });
    }
  });
});

// 좋아요 증가
exports.likeSchedule = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { eventId } = req.body;
      
      if (!eventId) {
        return res.status(400).json({ error: 'eventId가 필요합니다' });
      }

      const admin = require('firebase-admin');
      if (!admin.apps.length) {
        admin.initializeApp();
      }
      
      const db = admin.firestore();
      const likeRef = db.collection('schedule_likes').doc(eventId);
      
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(likeRef);
        
        if (!doc.exists) {
          transaction.set(likeRef, { likes: 1 });
        } else {
          const newLikes = (doc.data().likes || 0) + 1;
          transaction.update(likeRef, { likes: newLikes });
        }
      });

      const updatedDoc = await likeRef.get();
      
      return res.status(200).json({
        success: true,
        likes: updatedDoc.data().likes
      });

    } catch (error) {
      console.error('Error updating likes:', error);
      return res.status(500).json({ 
        error: '좋아요 업데이트 실패',
        details: error.message 
      });
    }
  });
});

// 좋아요 수 가져오기
exports.getScheduleLikes = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const { eventIds } = req.query;
      
      if (!eventIds) {
        return res.status(400).json({ error: 'eventIds가 필요합니다' });
      }

      const admin = require('firebase-admin');
      if (!admin.apps.length) {
        admin.initializeApp();
      }
      
      const db = admin.firestore();
      const ids = eventIds.split(',');
      const likesData = {};
      
      await Promise.all(ids.map(async (id) => {
        const doc = await db.collection('schedule_likes').doc(id).get();
        likesData[id] = doc.exists ? doc.data().likes : 0;
      }));

      return res.status(200).json({
        success: true,
        likes: likesData
      });

    } catch (error) {
      console.error('Error fetching likes:', error);
      return res.status(500).json({ 
        error: '좋아요 정보 가져오기 실패',
        details: error.message 
      });
    }
  });
});
