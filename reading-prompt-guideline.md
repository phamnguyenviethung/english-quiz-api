1. Mục tiêu chung
   Tạo micro-reading dùng để hoàn thành trong khoảng 10 phút.
   Mỗi reading đi kèm 3 câu hỏi trong một session.
   Nội dung ưu tiên daily life, practical English, relatable situations.
   Có thể sử dụng tình huống hư cấu, không yêu cầu câu chuyện có thật.
   Reading phải thú vị, tự nhiên và giống một tình huống người học có thể gặp.
2. Độ dài
   A1: 70–100 words.
   A2: 90–130 words.
   B1: 120–170 words.
   B2: 140–190 words.
   Không cố kéo dài bài để đạt word count.
   Ưu tiên nội dung cô đọng nhưng có đủ thông tin để tạo câu hỏi.
3. Chủ đề
   Xoay quanh chủ đề được input
   Ưu tiên các tình huống cụ thể thay vì chủ đề trừu tượng.
   Cho phép fictional scenarios.
   Tránh chủ đề khoa học, học thuật, chính trị, lịch sử hoặc technical nếu không được yêu cầu.
   Không yêu cầu người đọc phải có kiến thức bên ngoài để hiểu bài.
4. Nội dung
   Mỗi bài chỉ có một central topic / situation.
   Có cấu trúc rõ ràng:Situation
   Development / problem / action
   Result / decision / conclusion

Có khoảng 3–6 facts hoặc details rõ ràng.
Các facts phải liên quan logic với nhau.
Nội dung phải self-contained.
Ưu tiên người, địa điểm, hành động, vấn đề và quyết định cụ thể.
Tránh các câu chung chung kiểu textbook.
Không thêm thông tin chỉ để tăng word count.
Không yêu cầu kiến thức ngoài passage để trả lời câu hỏi. 5. Questionability
Passage phải chứa đủ thông tin để tạo nhiều câu hỏi khác nhau.
Phải có các chi tiết có thể dùng cho:Detail
Reason
Main idea
Inference
Vocabulary in context
Sequence
Cause & effect

Không viết passage quá đơn giản đến mức chỉ có một loại câu hỏi.
Không đưa thông tin mâu thuẫn.
Đáp án phải có thể xác định rõ từ passage. 6. Vocabulary
Vocabulary phải phù hợp với CEFR level.
Phần lớn từ vựng nên quen thuộc với learner.
Có thể đưa vào một số useful/challenging words phù hợp với level.
Ưu tiên vocabulary có giá trị sử dụng trong đời sống.
Không cố nhồi từ khó chỉ để tạo vocabulary questions.
Không dùng từ quá academic nếu không cần thiết. 7. Sentence complexity
Độ phức tạp câu phải phù hợp với CEFR.
A1/A2: ưu tiên câu ngắn và cấu trúc phổ biến.
B1: cho phép compound/complex sentences ở mức vừa phải.
B2: cho phép cấu trúc phức tạp hơn nhưng vẫn phải tự nhiên.
Không biến passage thành một chuỗi câu dài và khó đọc.
Không dùng cấu trúc grammar vượt quá level quá thường xuyên. 8. Naturalness
English phải tự nhiên, giống cách native speakers thực sự viết/nói.
Dialogue nếu phù hợp có thể được sử dụng.
Tên người, địa điểm và tình huống có thể được fictional.
Tránh văn phong textbook hoặc AI-generated quá rõ.
Không lạm dụng formal language. 9. Variety
Không lặp lại cùng một plot giữa các readings.
Không liên tục sử dụng cùng kiểu:"Someone forgot..."
"Someone went to..."
"Someone decided..."

Vary:Characters
Settings
Problems
Actions
Outcomes
Narrative style

10. Không tạo quiz ở bước này
    Reading Generator chỉ tạo reading.
    Không generate questions trong cùng output.
    Question generation là pipeline riêng.
    Reading phải được thiết kế sao cho có thể generate nhiều quiz type về sau.
11. Output
    Output phải structured JSON.
    {
    "title": "...",
    "paragraphs": [
    "...",
    "...",
    "..."
    ],
    "wordCount": 145,
    "topic": "...",
    "cefrLevel": "B1"
    }
    Chỉ trả về JSON.
    Không markdown.
    Không explanation ngoài JSON.
    wordCount phải phản ánh số từ thực tế.
    cefrLevel phải đúng với input.
12. Quality constraints
    Không hallucinate factual claims khi topic yêu cầu thông tin thực tế.
    Không đưa sensitive/political/controversial content nếu không cần.
    Không copy nguyên văn source.
    Nếu sử dụng source article, phải rewrite/adapt, không reproduce.
    Nội dung phải phù hợp với learner và mục tiêu học tiếng Anh.
    Readability và questionability quan trọng hơn việc truyền tải thật nhiều thông tin.
