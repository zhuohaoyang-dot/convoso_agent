#!/usr/bin/env python3
import subprocess
import time
from datetime import datetime
import csv
import os
import re
from PIL import Image
import pytesseract

class AutoSpamRecorder:
    def __init__(self, csv_file='spam_calls.csv'):
        self.csv_file = csv_file
        self.screenshot_path = '/tmp/screen.png'
        self.last_number = None
        self.call_detected = False
        self.initialize_csv()
        
    def initialize_csv(self):
        if not os.path.exists(self.csv_file):
            with open(self.csv_file, 'w', newline='') as f:
                writer = csv.writer(f)
                writer.writerow(['Number', 'Label', 'Date', 'Time'])
            print(f"创建 CSV: {self.csv_file}")
    
    def take_screenshot(self):
        """截屏"""
        try:
            result = subprocess.run(
                ['adb', 'exec-out', 'screencap', '-p'],
                capture_output=True,
                timeout=2
            )
            if result.returncode == 0:
                with open(self.screenshot_path, 'wb') as f:
                    f.write(result.stdout)
                return True
        except Exception as e:
            print(f"截屏失败: {e}")
        return False
    
    def ocr_screen(self):
        """OCR 识别屏幕文字"""
        try:
            img = Image.open(self.screenshot_path)
            text = pytesseract.image_to_string(img, lang='eng')
            return text
        except Exception as e:
            print(f"OCR 失败: {e}")
            return ""
    
    def extract_phone_number(self, text):
        """提取电话号码"""
        # 匹配各种格式
        patterns = [
            r'\+\d[\d\s\-\(\)]{10,}',  # +1 xxx xxx xxxx
            r'\(\d{3}\)\s*\d{3}[\s\-]?\d{4}',  # (xxx) xxx-xxxx
            r'\d{3}[\s\-]?\d{3}[\s\-]?\d{4}',  # xxx-xxx-xxxx
        ]
        
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                number = match.group(0)
                # 清理格式
                number = re.sub(r'[\s\-\(\)]', '', number)
                return number
        return None
    
    def detect_spam_label(self, text):
        """检测 spam 标签"""
        text_lower = text.lower()
        
        # 严格匹配
        if 'scam likely' in text_lower:
            return 'Scam Likely'
        elif 'telemarketing' in text_lower:
            return 'Telemarketing'
        elif 'spam' in text_lower:
            return 'Spam'
        
        return 'Regular'
    
    def is_call_screen(self, text):
        """判断是否在通话界面"""
        text_lower = text.lower()
        keywords = [
            'incoming call', 'calling', 'answer', 'decline',
            'reject', 'accept', 'end call', 'mobile', 'incoming'
        ]
        return any(keyword in text_lower for keyword in keywords)
    
    def record_call(self, number, label):
        """记录到 CSV"""
        now = datetime.now()
        
        with open(self.csv_file, 'a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow([
                number,
                label,
                now.strftime('%Y-%m-%d'),
                now.strftime('%H:%M:%S')
            ])
        
        print(f"\n{'='*60}")
        print(f"[Record] {now.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"Number: {number}")
        print(f"Label: {label}")
        print(f"{'='*60}\n")
    
    def start_monitoring(self):
        print("=" * 60)
        print("OCR Automated monitoring")
        print("=" * 60)
        print("Take screenshot every 2 seconds")
        print("Automatically recognize numbers and labels on the screen")
        print("Press Ctrl+C to stop")
        print("=" * 60)
        print()
        
        consecutive_no_call = 0
        
        try:
            while True:
                # 截屏
                if not self.take_screenshot():
                    time.sleep(2)
                    continue
                
                # OCR 识别
                text = self.ocr_screen()
                
                if not text:
                    time.sleep(2)
                    continue
                
                # 调试：打印识别的文本（前200字符）
                # print(f"[OCR] {text[:200]}")
                
                # 检测是否在通话界面
                if self.is_call_screen(text):
                    consecutive_no_call = 0
                    
                    if not self.call_detected:
                        print("[Detect] Found incoming call...")
                        self.call_detected = True
                    
                    # 提取号码
                    number = self.extract_phone_number(text)
                    
                    if number and number != self.last_number:
                        # 检测标签
                        label = self.detect_spam_label(text)
                        
                        # 记录
                        self.record_call(number, label)
                        self.last_number = number
                else:
                    consecutive_no_call += 1
                    
                    # 如果三次没有检测到通话，重置状态
                    if consecutive_no_call >= 3:
                        if self.call_detected:
                            print("[Status] Call ended\n")
                        self.call_detected = False
                        self.last_number = None
                
                time.sleep(2)  # 每 2 秒检查一次
                
        except KeyboardInterrupt:
            print("\n\nMonitoring stopped")
            print(f"Data saved to: {self.csv_file}")
            self.show_stats()
    
    def show_stats(self):
        """显示统计"""
        try:
            with open(self.csv_file, 'r') as f:
                lines = list(csv.DictReader(f))
                
            if not lines:
                print("No records")
                return
            
            total = len(lines)
            regular = sum(1 for l in lines if l['Label'] == 'Regular')
            telemarketing = sum(1 for l in lines if l['Label'] == 'Telemarketing')
            scam = sum(1 for l in lines if l['Label'] == 'Scam Likely')
            
            print(f"\nStatistics:")
            print(f"  Total: {total}")
            print(f"  Regular: {regular}")
            print(f"  Telemarketing: {telemarketing}")
            print(f"  Scam Likely: {scam}")
        except:
            pass

if __name__ == '__main__':
    recorder = AutoSpamRecorder()
    recorder.start_monitoring()