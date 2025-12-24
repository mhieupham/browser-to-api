# GPT Browser API

> Dự án này dựa trên [zsodur/chatgpt-api-by-browser-script](https://github.com/zsodur/chatgpt-api-by-browser-script). Credit thuộc về tác giả gốc.

[English Documentation](./README.en.md) | [中文文档](./README.zh.md)

Dự án này chạy trên trình duyệt của người dùng thông qua script Tampermonkey và chuyển đổi các thao tác trên phiên bản web của ChatGPT/Perplexity thành API interface. Bạn có thể sử dụng API này để làm nhiều việc thú vị, ví dụ như chạy [Auto-GPT](https://github.com/Significant-Gravitas/Auto-GPT).

## Cập nhật

2025-12-18: Hỗ trợ giao diện mới cho ChatGPT GPT-5.2 và Perplexity AI.

## Tính năng
- API miễn phí, không tốn phí.
- Nếu bạn có tài khoản ChatGPT Plus, bạn có thể sử dụng GPT-5.2 API.
- Có ngữ cảnh (context) không giới hạn.
- Khó bị cấm (banned) hơn và dễ xử lý lỗi hơn.
- Hỗ trợ cả ChatGPT và Perplexity AI.

![ChatGPT API Image](./demo.gif)

## Ứng dụng thực tế

API này có thể được sử dụng cho nhiều mục đích khác nhau:

### 1. Ứng dụng RAG (Retrieval-Augmented Generation)
Xây dựng các ứng dụng RAG nhỏ để trả lời câu hỏi dựa trên tài liệu nội bộ:
- Tìm kiếm và truy xuất thông tin từ cơ sở dữ liệu/vector database
- Gửi context và câu hỏi đến API để nhận câu trả lời chính xác
- Phù hợp cho chatbot nội bộ, hệ thống hỏi đáp tài liệu

### 2. Dịch tài liệu tự động
Sử dụng API để dịch tài liệu, văn bản với chất lượng cao:
- Dịch đa ngôn ngữ với ngữ cảnh được bảo toàn
- Dịch hàng loạt (batch translation) với script tự động
- Duy trì format và cấu trúc của tài liệu gốc

### 3. Tích hợp vào Auto-GPT
Sử dụng làm backend cho Auto-GPT để thực hiện các tác vụ tự động phức tạp.

### 4. Chatbot và trợ lý ảo
Xây dựng chatbot hoặc trợ lý ảo tùy chỉnh cho website/ứng dụng của bạn.

## Hướng dẫn sử dụng

### Bước 1: Cài đặt và Cấu hình Server

1. Đảm bảo hệ thống của bạn đã cài đặt Node.js và npm.
2. Clone repository này và chạy `npm install` trong thư mục dự án để cài đặt các dependencies.
3. Chạy `npm run start` để khởi động Node.js server.
4. Hoặc bạn có thể dùng Docker: `docker-compose up` để khởi động Node.js server.

### Bước 2: Cài đặt Tampermonkey Script

#### Nếu bạn sử dụng ChatGPT:

1. Cài đặt extension trình duyệt [Tampermonkey](https://www.tampermonkey.net/).
2. Mở bảng điều khiển Tampermonkey và tạo một script mới.
3. Sao chép toàn bộ nội dung của file `tampermonkey-script-chatgpt.js` vào script vừa tạo và lưu lại.
4. Đảm bảo script đã được bật (enabled) trong Tampermonkey.

#### Nếu bạn sử dụng Perplexity AI:

1. Cài đặt extension trình duyệt [Tampermonkey](https://www.tampermonkey.net/).
2. Mở bảng điều khiển Tampermonkey và tạo một script mới.
3. Sao chép toàn bộ nội dung của file `tampermonkey-script-Perplexity.js` vào script vừa tạo và lưu lại.
4. Đảm bảo script đã được bật (enabled) trong Tampermonkey.

### Bước 3: Cài đặt Extension Disable Content-Security-Policy

Extension này cần thiết để cho phép script hoạt động đúng cách.

Tải xuống từ [đây](https://chromewebstore.google.com/detail/disable-content-security/ieelmcmcagommplceebfedjlakkhpden)

### Bước 4: Mở và Đăng nhập

#### Nếu dùng ChatGPT:
Truy cập [https://chatgpt.com/](https://chatgpt.com/) hoặc [https://chat.openai.com/](https://chat.openai.com/) và đăng nhập vào tài khoản của bạn.

#### Nếu dùng Perplexity:
Truy cập [https://www.perplexity.ai/](https://www.perplexity.ai/) và đăng nhập vào tài khoản của bạn.

Nếu bạn thấy dòng chữ **"API Connected!"** màu xanh ở góc trên bên phải của trang web, bạn đã thành công!

![Success Image](./success.png)

### Bước 5: Sử dụng API

Bây giờ bạn đã có địa chỉ API: `http://localhost:8766/v1/chat/completions`

#### Các tham số API

| Tham số     | Mô tả                                           | Mặc định | Bắt buộc |
|-------------|-------------------------------------------------|----------|----------|
| messages    | Mảng tin nhắn (xem tài liệu OpenAI API)        |          | Có       |
| model       | Không còn hỗ trợ, vui lòng chọn model trên trang web |    | Không    |
| stream      | Stream response (xem tài liệu OpenAI API)       | false    | Không    |
| newChat     | Tạo cuộc trò chuyện mới (true/false)           | true     | Không    |

#### Ví dụ sử dụng với Curl

```bash
curl --location --request POST 'http://localhost:8766/v1/chat/completions' \
--header 'Content-Type: application/json' \
--data-raw '{
  "messages": [
    {
      "role": "system",
      "content": "Bạn là một trợ lý hữu ích. Chỉ trả lời, không tìm kiếm"
    },
    {
      "role": "user",
      "content": "Cách bơi giỏi là gì?"
    }
  ],
  "newChat": true
}'
```

#### Ví dụ với Python

```python
import requests

url = "http://localhost:8766/v1/chat/completions"
payload = {
    "messages": [
        {
            "role": "system",
            "content": "Bạn là một trợ lý hữu ích."
        },
        {
            "role": "user",
            "content": "Xin chào!"
        }
    ],
    "newChat": True
}

response = requests.post(url, json=payload)
print(response.json())
```

## Sử dụng với Auto-GPT

Sửa file `llm_utils.py` trong Auto-GPT:

```python
import requests

# response = openai.ChatCompletion.create(
#     model=model,
#     messages=messages,
#     temperature=temperature,
#     max_tokens=max_tokens,
# )

response = requests.post(
    "http://localhost:8766/v1/chat/completions",
    json={
        "messages": messages,
        "model": model,
        "newChat": False,
        "temperature": temperature,
        "max_tokens": max_tokens
    }
).json()

# return response.choices[0].message["content"]
return response["choices"][0]["message"]["content"]
```

## Lưu ý

- **Port mặc định**: Server chạy trên port `8766`. Đảm bảo port này không bị chiếm dụng bởi ứng dụng khác.
- **WebSocket**: Script Tampermonkey kết nối đến WebSocket server tại `ws://localhost:8765`.
- **Chọn model**: Để sử dụng GPT-5.2 (nếu bạn có ChatGPT Plus), hãy chọn model GPT-5.2 trực tiếp trên giao diện web của ChatGPT trước khi gửi request.
- **Perplexity modes**:
  - **Search**: Tìm kiếm thông tin cơ bản
  - **Research**: Nghiên cứu sâu hơn với nhiều nguồn
  - **Labs**: Chế độ thử nghiệm

## Khắc phục sự cố

1. **Không thấy "API Connected!"**:
   - Kiểm tra xem server Node.js đã chạy chưa
   - Kiểm tra script Tampermonkey đã được bật chưa
   - Kiểm tra console của trình duyệt để xem lỗi

2. **API không phản hồi**:
   - Đảm bảo bạn đã đăng nhập vào ChatGPT/Perplexity
   - Kiểm tra xem bạn đã cài đặt extension Disable Content-Security-Policy chưa
   - Thử refresh trang web

3. **Lỗi kết nối WebSocket**:
   - Đảm bảo server đang chạy
   - Kiểm tra firewall có chặn port 8765 và 8766 không

## License

MIT
