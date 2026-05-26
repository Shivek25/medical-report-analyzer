import { Router } from 'express';
import { uploadMiddleware } from '../middleware/upload.js';
import { extractTextFromPdf } from '../../lib/pdf/extractor.js';
import { UploadResponse } from '../../lib/types/index.js';

export const uploadRoute = Router();

uploadRoute.post('/upload', uploadMiddleware.single('report'), async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({
        success: false,
        error: 'No file uploaded or file is not a valid PDF.',
        code: 'VALIDATION_ERROR'
      });
      return;
    }

    const { path: filePath, originalname: originalFilename, size: sizeBytes, filename: fileId } = file;

    // Call the text extractor
    const result = await extractTextFromPdf(filePath, originalFilename);

    const response: UploadResponse = {
      success: true,
      fileId,
      fileName: originalFilename,
      sizeBytes,
      message: 'File successfully uploaded and parsed.',
      result
    };

    res.status(200).json(response);
    return;
  } catch (err: any) {
    if (err.message === 'Only PDF files are allowed!') {
        res.status(400).json({ success: false, error: err.message, code: 'VALIDATION_ERROR' });
        return;
    }
    return next(err);
  }
});
