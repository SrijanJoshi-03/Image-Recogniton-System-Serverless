from datetime import datetime,timezone # to create timestamp so of that time when data is stored in dynamodb.
import boto3 #library to talk to aws
import os #to access the OS environment variables (bad practice), SSM should be used which will be added in future.
import json # most browsers accept response in json and event returned by aws serviees is in json format.
from decimal import Decimal #to store the confidence score as decimal in dynamodb as it is a number with decimal point.


s3= boto3.client('s3') # calls AWS s3 api.
dynamo_db = boto3.resource('dynamodb', region_name='us-east-1') #calls AWS DynamoDb api
client = boto3.client('rekognition', region_name='us-east-1') # calss AWS Rekognition api.


def lambda_handler(event,context): #loading what event caused this funciton to get triggered.
    try: #try is used to avoid runtime errors.
        Records=event.get('Records',[]) #gets all the records from the queue.
        for record in Records: 
            prased_json = json.loads(record.get('body', '{}')) # record is a string object so we prashing to a dictinary.
            bucket_name = prased_json.get('detail',{}).get('bucket',{}).get('name','') # getting the bucket name form events.
            object_key = prased_json.get('detail', {}).get('object', {}).get('key', '') #getting image key(file_name) from events.

            if not bucket_name or not object_key: #validation check.
                print("Invalid event structure")
                continue
            
            response_from_rekogniton_for_image_labels =client.detect_labels( # call aws rekognition for detecting labels in an image
                Image={ #refrences this particulat image in this particular s3 bucket whose deatils has been passed as an event when this funciton gets triggered.
                    'S3Object': {
                        'Bucket': bucket_name,
                        'Name': object_key
                    }
                },
                MaxLabels=3, # can return upto 100 lables but we only return 3 for cost reasons.
                MinConfidence=90 # only return labels with confidence score of 90 or greater.
            )
            lables = response_from_rekogniton_for_image_labels.get('Labels') #the above defined variable is a list object the only thing we need form there is Labels which is a list object.
            if lables: #if lables exists.
                table = dynamo_db.Table(os.environ['DYNAMODB_TABLE_NAME']) # defines the table where data has to be written
                timestamp_count = 0 # to make the sort key unique when images are getting uploaded form multiple users at once, as it cannot be duplicate.
                for label in lables: # we want individual item inside labels list not the enitire list.
                    table.put_item( #putting each item in the dynamodb table.
                        Item={
                            'image-id': f"{object_key}",
                            'timestamp': f"{datetime.now(timezone.utc).isoformat()}-{timestamp_count}",
                            'confidence': Decimal(str(label['Confidence'])),
                            'label': label['Name'],
                            'status': 'processed'
                        }
                    )
                    timestamp_count += 1 # increments the val;ue to make sure SK is unique.
        return{ #response to the sqs queue that this job is done.
            "statusCode" : 200,
            "body": json.dumps({
                "message": "Labels detected and stored successfully"
            })
            }
    except Exception as e: # if any unexpeted error occurs then this will be returned.
        print(f"Error: {e}")
        return{
            "statusCode" : 500,
            "body": json.dumps({
                "message": "Internal server error"
            })
        }    









