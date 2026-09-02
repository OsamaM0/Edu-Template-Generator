/* global use, db */
// MongoDB Playground
// Use Ctrl+Space inside a snippet or a string literal to trigger completions.




// The current database to use.
use("ai");

// Find a document in a collection.
db.getCollection("questions").findOne({
     document_idx: "712"
});


// The current database to use.
use("ai");

// Find a document in a collection.
db.getCollection("worksheets").find({
     document_idx: "712"
});


use("ien-v2");

// Find a document in a collection.
db.getCollection("lessonplangoals").find({
     lessonId: 712
});


// 
use("ien-v2");

// Find a document in a collection.
db.getCollection("lessonmappinggoals").findOne({
     lessonId: 712
});


// 
use("ien");

// Find a document in a collection.
db.getCollection("lessons").find({
     lessonId: 437
});


// 
use("ien-v2");

// Find a document in a collection.
db.getCollection("lessons").find({
     lessonId: 437
});


// 
use("ien-v2");

// Find a document in a collection.
db.getCollection("lessons").count({
     createdAt: {
          $gte: new Date("2026-01-01T00:00:00.000Z")
     }
});

