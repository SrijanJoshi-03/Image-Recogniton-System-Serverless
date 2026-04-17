import json # most browsers accept response in json and event returned by aws serviees is in json format.
import boto3 #library to talk to aws.
import uuid # libray to help standardize the upload file name.
import os #to access the OS environment variables (bad practice), SSM should be used which will be added in future.

# Configuration - Best practice to use Environment Variables, but recommended is SSM, will be added in future.
BUCKET_NAME = os.environ.get("BUCKET_NAME", "useruploadsbucket00084r5")
s3 = boto3.client('s3') #calls aws s3 api.

def lambda_handeler(event, context):
    try:
        # 1. Safely parse the incoming event body
        # Handles cases where API Gateway sends the body as a string or a dict
        raw_body = event.get('body')
        if raw_body is None:
            return {
                'statusCode': 400,
                'headers': { 'Access-Control-Allow-Origin': '*' },
                'body': json.dumps({'error': 'Empty request body'})
            }
            
        body = json.loads(raw_body) if isinstance(raw_body, str) else raw_body

        # 2. Extract file metadata from the React request
        original_filename = body.get('filename', 'image.jpg')
        content_type = body.get('contentType', 'image/jpeg')
        
        # 3. Logic for folder and custom filename
        # We extract the extension to ensure 'upload1' has the correct format (.png, .jpg, etc)
        extension = original_filename.split('.')[-1] if '.' in original_filename else 'jpg'
        
        # Note: Using a UUID prefix is better DevOps practice to prevent users 
        # from overwriting 'upload1.jpg' constantly.
        unique_id = str(uuid.uuid4())[:8]
        new_filename = f"upload_{unique_id}.{extension}"
        
        # In S3, the folder is just a prefix in the Key
        s3_key = f"uploads/{new_filename}"

        # 4. Generate the Presigned URL
        # The 'put_object' method allows the browser to upload directly
        presigned_url = s3.generate_presigned_url(
            ClientMethod='put_object',
            Params={
                'Bucket': BUCKET_NAME,
                'Key': s3_key,
                'ContentType': content_type
            },
            ExpiresIn=300 # URL valid for 5 minutes
        )

        # 5. Return the response with mandatory CORS headers for React
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'OPTIONS,POST',
                'Content-Type': 'application/json'
            },
            'body': json.dumps({
                'imageId': s3_key,
                'presignedUrl': presigned_url
            })
        }

    except Exception as e: # if any unexpected error occurs then it will return this.
        print(f"Error encountered: {str(e)}")
        return {
            'statusCode': 500,
            'headers': { 'Access-Control-Allow-Origin': '*' },
            'body': json.dumps({
                'error': 'Internal Server Error',
                'details': str(e)
            })
        }